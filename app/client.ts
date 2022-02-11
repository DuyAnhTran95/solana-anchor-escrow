import * as anchor from "@project-serum/anchor";
import { PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import { Token, TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
require("dotenv").config();

const idl = JSON.parse(
  fs.readFileSync("./target/idl/anchor_test.json", "utf-8")
);

const secretKey = Uint8Array.from(
  JSON.parse(fs.readFileSync(process.env.PAYER_PK, "utf-8"))
);

const programId = new anchor.web3.PublicKey(idl.metadata?.address);

const escrowAcc = anchor.web3.Keypair.generate();
const initializer = anchor.web3.Keypair.generate();
const taker = anchor.web3.Keypair.generate();
const mintAuthority = anchor.web3.Keypair.generate();
const vaultAcc = new anchor.web3.Keypair();
const payer = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));

let initializerTokenAccA: PublicKey;
let initializerTokenAccB: PublicKey;
let takerTokenAccA: PublicKey;
let takerTokenAccB: PublicKey;
let mintA: Token, mintB: Token;

const provider = anchor.Provider.local();

anchor.setProvider(provider);

const escrowProgram = new anchor.Program(idl, programId);

async function setup() {
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(initializer.publicKey, 10000000000),
    "processed"
  );

  mintA = await Token.createMint(
    provider.connection,
    payer,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    6,
    TOKEN_PROGRAM_ID
  );

  console.log(`tokenA: ${mintA.publicKey.toBase58()}`)

  mintB = await Token.createMint(
    provider.connection,
    payer,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    6,
    TOKEN_PROGRAM_ID
  );

  initializerTokenAccA = await mintA.createAccount(initializer.publicKey);
  initializerTokenAccB = await mintB.createAccount(initializer.publicKey);
  takerTokenAccA = await mintA.createAccount(taker.publicKey);
  takerTokenAccB = await mintB.createAccount(taker.publicKey);

  await mintA.mintTo(
    initializerTokenAccA,
    mintAuthority.publicKey,
    [mintAuthority],
    1000,
  );

  await mintB.mintTo(
    takerTokenAccB,
    mintAuthority.publicKey,
    [mintAuthority],
    1000,
  )
}

async function main() {
  await setup();

  await escrowProgram.rpc.initEscrow(new anchor.BN(10), {
    accounts: {
      user: initializer.publicKey,
      tokenRxAcc: initializerTokenAccB,
      escrowInfo: escrowAcc.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
      vaultAcc: vaultAcc.publicKey,
      // mint: mintB.publicKey,
    },
    instructions: [
      SystemProgram.createAccount({
        programId: TOKEN_PROGRAM_ID,
        space: AccountLayout.span,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(
          AccountLayout.span
        ),
        fromPubkey: initializer.publicKey,
        newAccountPubkey: vaultAcc.publicKey,
      }),
      Token.createInitAccountInstruction(
        TOKEN_PROGRAM_ID,
        mintA.publicKey,
        vaultAcc.publicKey,
        initializer.publicKey
      ),
      Token.createTransferInstruction(
        TOKEN_PROGRAM_ID,
        initializerTokenAccA,
        vaultAcc.publicKey,
        initializer.publicKey,
        [initializer],
        20,
      ),
    ],
    signers: [escrowAcc, initializer, vaultAcc],
  });

  let vaultAccBal = await getTokenBalance(vaultAcc.publicKey, provider.connection);
  console.log(`vault acc bal: ${vaultAccBal}`);

  const [vaultPDA] = await PublicKey.findProgramAddress(
    [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
    escrowProgram.programId,
  )

  escrowProgram.rpc.exchange({
    accounts: {
      taker: taker.publicKey,
      initializer: initializer.publicKey,
      escrowInfo: escrowAcc.publicKey,
      initializerTokenRxAcc: initializerTokenAccB,
      takerTokenRxAcc: takerTokenAccA,
      takerTokenDepositAcc: takerTokenAccB,
      tokenProgram: TOKEN_PROGRAM_ID,
      vaultAcc: vaultAcc.publicKey,
      vaultPda: vaultPDA,
    },
    signers: [taker],
  });

  console.log(await getTokenBalance(initializerTokenAccB, provider.connection))
}

async function getTokenBalance(
  pubkey: PublicKey,
  connection: Connection
) {
  return parseInt(
    (await connection.getTokenAccountBalance(pubkey)).value.amount
  );
};

main().then((rs) => {
  console.log("done");
});

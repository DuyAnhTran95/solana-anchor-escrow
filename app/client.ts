import * as anchor from "@project-serum/anchor";
import { PublicKey, SOLANA_SCHEMA, SystemProgram } from "@solana/web3.js";
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
const mintAuthority = anchor.web3.Keypair.generate();
const vaultAcc = new anchor.web3.Keypair();
const payer = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));

let initializerTokenAccA: PublicKey;
let initializerTokenAccB: PublicKey;
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

  await mintA.mintTo(
    initializerTokenAccA,
    mintAuthority.publicKey,
    [mintAuthority],
    1000
  );
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
      // await escrowProgram.account.escrow.createInstruction(escrowAcc),
    ],
    signers: [escrowAcc, initializer, vaultAcc],
  });

  let _escrowAcc = await escrowProgram.account.escrow.fetch(
    escrowAcc.publicKey
  );

  console.log(_escrowAcc);
}

main().then((rs) => {
  console.log("done");
});

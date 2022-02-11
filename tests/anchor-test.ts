import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Token, TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorTest } from "../target/types/anchor_test";
import { readFileSync } from "fs";
import * as chai from "chai";
import { expect } from "chai";
const chaiAsPromised = require("chai-as-promised");

require("dotenv").config();
chai.use(chaiAsPromised);

const expect = chai.expect;

const idl = JSON.parse(readFileSync("./target/idl/anchor_test.json", "utf-8"));

const secretKey = Uint8Array.from(
  JSON.parse(readFileSync(process.env.PAYER_PK, "utf-8"))
);

describe("anchor-test", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const provider = anchor.getProvider();

  const escrowProgram = anchor.workspace.AnchorTest as Program<AnchorTest>;
  console.log(escrowProgram.programId.toBase58());

  const initializer = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));

  let initializerTokenAccA: PublicKey;
  let initializerTokenAccB: PublicKey;
  let takerTokenAccA: PublicKey;
  let takerTokenAccB: PublicKey;
  let mintA: Token, mintB: Token;

  before(async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        initializer.publicKey,
        10000000000
      ),
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
    takerTokenAccA = await mintA.createAccount(taker.publicKey);
    takerTokenAccB = await mintB.createAccount(taker.publicKey);

    await mintA.mintTo(
      initializerTokenAccA,
      mintAuthority.publicKey,
      [mintAuthority],
      1000
    );

    await mintB.mintTo(
      takerTokenAccB,
      mintAuthority.publicKey,
      [mintAuthority],
      1000
    );
  });

  it("exchange escrow", async () => {
    const escrowAcc = anchor.web3.Keypair.generate();
    const vaultAcc = new anchor.web3.Keypair();
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
      preInstructions: [
        // create vault account for store tokenA
        SystemProgram.createAccount({
          programId: TOKEN_PROGRAM_ID,
          space: AccountLayout.span,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(
            AccountLayout.span
          ),
          fromPubkey: initializer.publicKey,
          newAccountPubkey: vaultAcc.publicKey,
        }),
        // create token account for vault
        Token.createInitAccountInstruction(
          TOKEN_PROGRAM_ID,
          mintA.publicKey,
          vaultAcc.publicKey,
          initializer.publicKey
        ),
        // transfer token to vault
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          initializerTokenAccA,
          vaultAcc.publicKey,
          initializer.publicKey,
          [initializer],
          20
        ),
      ],
      signers: [escrowAcc, initializer, vaultAcc],
    });

    let vaultAccBal = await getTokenBalance(vaultAcc.publicKey);

    let escrowAccDat = await escrowProgram.account.escrow.fetch(
      escrowAcc.publicKey
    );

    expect(vaultAccBal).equals(20);
    expect(escrowAccDat.expectedAmount.toString()).equals("10");
    expect(escrowAccDat.initializer.toBase58()).equals(
      initializer.publicKey.toBase58()
    );
    expect(escrowAccDat.initializerRxAcc.toBase58()).equals(
      initializerTokenAccB.toBase58()
    );
    expect(escrowAccDat.isInitialized).true;
    expect(escrowAccDat.vaultAcc.toBase58()).equals(
      vaultAcc.publicKey.toBase58()
    );

    const [vaultPDA] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      escrowProgram.programId
    );

    await escrowProgram.rpc.exchange({
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

    let initializerReceiveBal = await getTokenBalance(initializerTokenAccB);
    let takerReceiveBal = await getTokenBalance(takerTokenAccA)

    expect(initializerReceiveBal.toString()).equals("10")
    expect(takerReceiveBal.toString()).equals("20");
  });
});

async function getTokenBalance(pubkey: PublicKey) {
  return parseInt(
    (await anchor.getProvider().connection.getTokenAccountBalance(pubkey)).value
      .amount
  );
}

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

declare_id!("HKu3iNjUuQbimNN4W6qZahvXn4rchaESwcPvsV1sdQsW");

#[program]
pub mod anchor_test {
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";

    pub fn init_escrow(ctx: Context<InitializeEscrow>, expected_amount: u64) -> ProgramResult {
        let escrow_info = &mut ctx.accounts.escrow_info;
        if escrow_info.is_initialized == true {
            return Err(EscrowError::AlreadyInitError.into());
        }

        escrow_info.is_initialized = true;
        escrow_info.initializer = *ctx.accounts.user.key;
        escrow_info.initializer_rx_acc = *ctx.accounts.token_rx_acc.to_account_info().key;
        escrow_info.vault_acc = *ctx.accounts.vault_acc.to_account_info().key;
        escrow_info.expected_amount = expected_amount;

        let (vault_pda, _vault_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);

        let set_auth_cpi = SetAuthority {
            current_authority: ctx.accounts.user.to_account_info().clone(),
            account_or_mint: ctx.accounts.vault_acc.to_account_info().clone(),
        };
        let auth_cpi_ctx = CpiContext::new(ctx.accounts.token_program.clone(), set_auth_cpi);
        token::set_authority(auth_cpi_ctx, AuthorityType::AccountOwner, Some(vault_pda))?;

        Ok(())
    }

    pub fn exchange(ctx: Context<Exchange>) -> ProgramResult {
        let escrow_info = &mut ctx.accounts.escrow_info;

        if escrow_info.initializer != *ctx.accounts.initializer.to_account_info().key {
            return Err(EscrowError::InvalidAccountError.into());
        }

        if escrow_info.initializer_rx_acc
            != *ctx.accounts.initializer_token_rx_acc.to_account_info().key
        {
            return Err(EscrowError::InvalidAccountError.into());
        }

        if escrow_info.vault_acc != *ctx.accounts.vault_acc.to_account_info().key {
            return Err(EscrowError::InvalidAccountError.into());
        }

        let (vault_pda, vault_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);

        if vault_pda != *ctx.accounts.vault_pda.key {
            return Err(EscrowError::InvalidAccountError.into());
        }
        let vault_auth = &[&ESCROW_PDA_SEED[..], &[vault_bump]];

        // transfer token to initializer
        let to_initializer_transfer = Transfer {
            from: ctx
                .accounts
                .taker_token_deposit_acc
                .to_account_info()
                .clone(),
            to: ctx
                .accounts
                .initializer_token_rx_acc
                .to_account_info()
                .clone(),
            authority: ctx.accounts.taker.to_account_info().clone(),
        };
        let initializer_transfer_ctx =
            CpiContext::new(ctx.accounts.token_program.clone(), to_initializer_transfer);
        msg!("Send token to initializer");
        token::transfer(initializer_transfer_ctx, escrow_info.expected_amount)?;

        // transfer token to taker
        let to_taker_transfer = Transfer {
            from: ctx.accounts.vault_acc.to_account_info().clone(),
            to: ctx.accounts.taker_token_rx_acc.to_account_info().clone(),
            authority: ctx.accounts.vault_pda.clone(),
        };
        let taker_transfer_ctx =
            CpiContext::new(ctx.accounts.token_program.clone(), to_taker_transfer);
        msg!("Send token to taker");
        token::transfer(
            taker_transfer_ctx.with_signer(&[&vault_auth[..]]),
            ctx.accounts.vault_acc.amount,
        )?;

        // close vault account
        let close_vault = CloseAccount {
            account: ctx.accounts.vault_acc.to_account_info().clone(),
            destination: ctx.accounts.initializer.to_account_info().clone(),
            authority: ctx.accounts.vault_pda.clone(),
        };
        let close_vault_ctx = CpiContext::new(ctx.accounts.token_program.clone(), close_vault);
        msg!("Close vault token account");
        token::close_account(close_vault_ctx.with_signer(&[&vault_auth[..]]))?;

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> ProgramResult {
        let escrow_info = &mut ctx.accounts.escrow_info;

        if escrow_info.initializer != *ctx.accounts.initializer.to_account_info().key {
            return Err(EscrowError::InvalidAccountError.into());
        }

        let (vault_pda, vault_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);

        if vault_pda != *ctx.accounts.vault_pda.key {
            return Err(EscrowError::InvalidAccountError.into());
        }
        let vault_auth = &[&ESCROW_PDA_SEED[..], &[vault_bump]];

        // return token back to initializer
        let to_taker_transfer = Transfer {
            from: ctx.accounts.vault_acc.to_account_info().clone(),
            to: ctx.accounts.token_deposit_acc.to_account_info().clone(),
            authority: ctx.accounts.vault_pda.clone(),
        };
        let taker_transfer_ctx =
            CpiContext::new(ctx.accounts.token_program.clone(), to_taker_transfer);
        msg!("Return token to initializer");
        token::transfer(
            taker_transfer_ctx.with_signer(&[&vault_auth[..]]),
            ctx.accounts.vault_acc.amount,
        )?;

        // close vault account
        let close_vault = CloseAccount {
            account: ctx.accounts.vault_acc.to_account_info().clone(),
            destination: ctx.accounts.initializer.to_account_info().clone(),
            authority: ctx.accounts.vault_pda.clone(),
        };
        let close_vault_ctx = CpiContext::new(ctx.accounts.token_program.clone(), close_vault);
        msg!("Close vault token account");
        token::close_account(close_vault_ctx.with_signer(&[&vault_auth[..]]))?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(init, payer = user, space = 8 + 8 + 32 * 3  + 8)]
    pub escrow_info: Account<'info, Escrow>,
    pub user: Signer<'info>,
    pub token_rx_acc: Account<'info, TokenAccount>,
    pub token_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    #[account(mut, rent_exempt = enforce)]
    pub vault_acc: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct Exchange<'info> {
    pub taker: Signer<'info>,
    #[account(mut)]
    pub initializer: AccountInfo<'info>,
    #[account(mut, close = initializer)]
    pub escrow_info: Account<'info, Escrow>,
    #[account(mut)]
    pub initializer_token_rx_acc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub taker_token_rx_acc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub taker_token_deposit_acc: Account<'info, TokenAccount>,
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub vault_acc: Account<'info, TokenAccount>,
    pub vault_pda: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(mut, close = initializer)]
    pub escrow_info: Account<'info, Escrow>,
    #[account(mut)]
    pub token_deposit_acc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_acc: Account<'info, TokenAccount>,
    pub vault_pda: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

#[account]
pub struct Escrow {
    pub is_initialized: bool,
    pub initializer: Pubkey,
    pub vault_acc: Pubkey,
    pub initializer_rx_acc: Pubkey,
    pub expected_amount: u64,
}

#[error]
pub enum EscrowError {
    #[msg("Invalid account")]
    InvalidAccountError,
    #[msg("Exchange token amount invalid")]
    InvalidExchangeAmountError,
    #[msg("Escrow already init")]
    AlreadyInitError,
}

use anchor_lang::prelude::*;
use anchor_spl::token::{self, SetAuthority, TokenAccount};
use spl_token::instruction::AuthorityType;

declare_id!("HKu3iNjUuQbimNN4W6qZahvXn4rchaESwcPvsV1sdQsW");

#[program]
pub mod anchor_test {
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";

    pub fn init_escrow(ctx: Context<InitializeEscrow>, expected_amount: u64) -> ProgramResult {
        let escrow_info = &mut ctx.accounts.escrow_info;
        escrow_info.is_initialized = true;
        escrow_info.initializer = *ctx.accounts.user.key;
        escrow_info.initializer_rx_acc =
            *ctx.accounts.token_rx_acc.to_account_info().key;
        escrow_info.escrow_token_acc = *ctx.accounts.token_program.key;
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

    pub fn exchange(_ctx: Context<Exchange>) -> ProgramResult {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(init, payer = user, space = 8 + 8 + 32 * 3  + 8)]
    pub escrow_info: Account<'info, Escrow>,
    #[account(mut @ EscrowError::InvalidAccount)]
    pub user: Signer<'info>,
    pub token_rx_acc: Account<'info, TokenAccount>,
    pub token_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    #[account(mut @ EscrowError::InvalidAccount, rent_exempt = enforce)]
    pub vault_acc: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct Exchange<'info> {
    pub escrow_info: Account<'info, Escrow>,
    pub initializer_token_rx_acc: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
}

#[account]
pub struct Escrow {
    pub is_initialized: bool,
    pub initializer: Pubkey,
    pub escrow_token_acc: Pubkey,
    pub initializer_rx_acc: Pubkey,
    pub expected_amount: u64,
}

#[error]
pub enum EscrowError {
    #[msg("Invalid account")]
    InvalidAccount,
}

#!/usr/bin/env node
/**
 * Create (or reuse) a Chatwoot account, an administrator and its API access
 * token inside the running Chatwoot container, and print the variables the
 * opt-in Chatwoot suite reads:
 *
 *   node packages/sandbox/docker/chatwoot-token.mjs [container]   # default botmesh-sandbox-chatwoot
 *
 * Throwaway local credentials only: never point this at a real Chatwoot.
 */
import { execFileSync } from 'node:child_process'

const container = process.argv[2] ?? `${process.env.SANDBOX_PREFIX ?? 'botmesh-sandbox'}-chatwoot`
const ruby = `
account = Account.find_or_create_by!(name: 'botmesh sandbox')
user = User.find_by(email: 'sandbox@botmesh.test')
unless user
  user = User.new(name: 'Sandbox Agent', email: 'sandbox@botmesh.test', password: 'Sandbox-pass-123!', password_confirmation: 'Sandbox-pass-123!')
  user.skip_confirmation!
  user.save!
end
AccountUser.find_or_create_by!(account_id: account.id, user_id: user.id) { |au| au.role = :administrator }
token = (user.access_token || AccessToken.create!(owner: user)).token
puts "BOTWA_TEST_CHATWOOT_ACCOUNT_ID=#{account.id}"
puts "BOTWA_TEST_CHATWOOT_TOKEN=#{token}"
`
const out = execFileSync('docker', ['exec', container, 'bundle', 'exec', 'rails', 'runner', ruby], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const lines = out.split('\n').filter((l) => l.startsWith('BOTWA_TEST_CHATWOOT_'))
process.stdout.write(`BOTWA_TEST_CHATWOOT_URL=http://127.0.0.1:47813\n${lines.join('\n')}\n`)

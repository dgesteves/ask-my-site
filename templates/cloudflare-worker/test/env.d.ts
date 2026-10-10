// The Worker's bindings, as the tests' `env` from cloudflare:test has them.
declare namespace Cloudflare {
  interface Env {
    SITE_URL: string;
    CHAT_MODEL: string;
    AI: Ai;
  }
}

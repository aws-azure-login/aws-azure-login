// Type definitions for express-prom-bundle 3.3
// Project: https://github.com/TooTallNate/node-proxy-agent/
// Definitions by: Kenneth Aasan <https://github.com/kennethaasan/>
// TypeScript Version: 3.7

declare module "proxy-agent" {
  import { Agent, AgentOptions } from "https";

  export default function ProxyAgent(options: AgentOptions | string): Agent;
}

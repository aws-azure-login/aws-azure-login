#!/usr/bin/env node

process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

import { Command } from "commander";
import puppeteer, { Browser } from "puppeteer";
import mkdirp from "mkdirp";
import { configureProfileAsync } from "./configureProfileAsync";
import { login } from "./login";
import { paths } from "./paths";

// source: https://docs.microsoft.com/en-us/azure/active-directory/hybrid/how-to-connect-sso-quick-start#google-chrome-all-platforms
const AZURE_AD_SSO = "autologon.microsoftazuread-sso.com";

const program = new Command();

program
  .option(
    "-p, --profile <name>",
    "The name of the profile to log in with (or configure)"
  )
  .option("-a, --all-profiles", "Run for all configured profiles")
  .option(
    "-f, --force-refresh",
    "Force a credential refresh, even if they are still valid"
  )
  .option("-c, --configure", "Configure the profile")
  .option(
    "-m, --mode <mode>",
    "'cli' to hide the login page and perform the login through the CLI (default behavior), 'gui' to perform the login through the Azure GUI (more reliable but only works on GUI operating system), 'debug' to show the login page but perform the login through the CLI (useful to debug issues with the CLI login)"
  )
  .option(
    "--no-sandbox",
    "Disable the Puppeteer sandbox (usually necessary on Linux)"
  )
  .option(
    "--no-prompt",
    "Do not prompt for input and accept the default choice",
    false
  )
  .option(
    "--enable-chrome-network-service",
    "Enable Chromium's Network Service (needed when login provider redirects with 3XX)"
  )
  .option(
    "--no-verify-ssl",
    "Disable SSL Peer Verification for connections to AWS (no effect if behind proxy)"
  )
  .option(
    "--enable-chrome-seamless-sso",
    "Enable Chromium's pass-through authentication with Azure Active Directory Seamless Single Sign-On"
  )
  .option(
    "--no-disable-extensions",
    "Tell Puppeteer not to pass the --disable-extensions flag to Chromium"
  )
  .option(
    "--disable-gpu",
    "Tell Puppeteer to pass the --disable-gpu flag to Chromium"
  )
  .parse(process.argv);

const options = program.opts();

const profileName =
  (options.profile as string | undefined) ||
  process.env.AWS_PROFILE ||
  "default";
const mode = (options.mode as string | undefined) || "cli";
const disableSandbox = !options.sandbox;
const noPrompt = !options.prompt;
const enableChromeNetworkService = !!options.enableChromeNetworkService;
const awsNoVerifySsl = !options.verifySsl;
const enableChromeSeamlessSso = !!options.enableChromeSeamlessSso;
const forceRefresh = !!options.forceRefresh;
const noDisableExtensions = !options.disableExtensions;
const disableGpu = !!options.disableGpu;

async function launchBrowser(): Promise<Browser> {
  const headless = mode === "cli";
  const args: string[] = [];

  if (!headless) {
    const WIDTH = 425;
    const HEIGHT = 550;
    args.push(`--window-size=${WIDTH},${HEIGHT}`);
  }

  if (disableSandbox) args.push("--no-sandbox");
  if (enableChromeNetworkService)
    args.push("--enable-features=NetworkService");
  if (enableChromeSeamlessSso)
    args.push(
      `--auth-server-whitelist=${AZURE_AD_SSO}`,
      `--auth-negotiate-delegate-whitelist=${AZURE_AD_SSO}`
    );
  if (disableGpu) args.push("--disable-gpu");
  if (process.env.https_proxy) {
    args.push(`--proxy-server=${process.env.https_proxy}`);
  }

  await mkdirp(paths.chromium);
  args.push(`--user-data-dir=${paths.chromium}`);

  const ignoreDefaultArgs = noDisableExtensions
    ? ["--disable-extensions"]
    : [];

  return puppeteer.launch({
    headless,
    args,
    ignoreDefaultArgs,
  });
}

Promise.resolve()
  .then(async () => {
    if (options.configure) return configureProfileAsync(profileName);

    const browser = await launchBrowser();
    try {
      if (options.allProfiles) {
        return await login.loginAll(
          mode,
          browser,
          noPrompt,
          awsNoVerifySsl,
          forceRefresh,
        );
      }

      return await login.loginAsync(
        profileName,
        mode,
        browser,
        noPrompt,
        awsNoVerifySsl,
      );
    } finally {
      await browser.close();
    }
  })
  .then(() => {
    process.exit(0)
  })
  .catch((err: Error) => {
    if (err.name === "CLIError") {
      console.error(err.message);
      process.exit(2);
    } else {
      console.log(err);
    }
  });

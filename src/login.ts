import _ from "lodash";
import Bluebird from "bluebird";
import inquirer, { QuestionCollection, Question } from "inquirer";
import zlib from "zlib";
import { STS, STSClientConfig } from "@aws-sdk/client-sts";
import { load } from "cheerio";
import { v4 } from "uuid";
import puppeteer, { HTTPRequest } from "puppeteer";
import querystring from "querystring";
import _debug from "debug";
import { CLIError } from "./CLIError";
import { awsConfig, ProfileConfig } from "./awsConfig";
import proxy from "proxy-agent";
import { paths } from "./paths";
import mkdirp from "mkdirp";
import { Agent } from "https";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const debug = _debug("aws-azure-login");

const WIDTH = 425;
const HEIGHT = 550;
const DELAY_ON_UNRECOGNIZED_PAGE = 1000;
const MAX_UNRECOGNIZED_PAGE_DELAY = 30 * 1000;

// source: https://docs.microsoft.com/en-us/azure/active-directory/hybrid/how-to-connect-sso-quick-start#google-chrome-all-platforms
const AZURE_AD_SSO = "autologon.microsoftazuread-sso.com";
const AWS_SAML_ENDPOINT = "https://signin.aws.amazon.com/saml";
const AWS_CN_SAML_ENDPOINT = "https://signin.amazonaws.cn/saml";
const AWS_GOV_SAML_ENDPOINT = "https://signin.amazonaws-us-gov.com/saml";

interface Role {
  roleArn: string;
  principalArn: string;
}

/**
 * To proxy the input/output of the Azure login page, it's easiest to run a loop that
 * monitors the state of the page and then perform the corresponding CLI behavior.
 * The states have a name that is used for the debug messages, a selector that is used
 * with puppeteer's page.$(selector) to determine if the state is active, and a handler
 * that is called if the state is active.
 */
const states = [
  {
    name: "username input",
    selector: `input[name="loginfmt"]:not(.moveOffScreen)`,
    async handler(
      page: puppeteer.Page,
      _selected: puppeteer.ElementHandle,
      noPrompt: boolean,
      defaultUsername: string
    ): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorMessage = await page.evaluate(
          // eslint-disable-next-line
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
      }

      let username;

      if (noPrompt && defaultUsername) {
        debug("Not prompting user for username");
        username = defaultUsername;
      } else {
        debug("Prompting user for username");
        ({ username } = await inquirer.prompt([
          {
            name: "username",
            message: "Username:",
            default: defaultUsername,
          } as Question,
        ]));
      }

      debug("Waiting for username input to be visible");
      await page.waitForSelector(`input[name="loginfmt"]`, {
        visible: true,
        timeout: 60000,
      });

      debug("Focusing on username input");
      await page.focus(`input[name="loginfmt"]`);

      debug("Clearing input");
      for (let i = 0; i < 100; i++) {
        await page.keyboard.press("Backspace");
      }

      debug("Typing username");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await page.keyboard.type(username);

      await Bluebird.delay(500);

      debug("Waiting for submit button to be visible");
      await page.waitForSelector(`input[type=submit]`, {
        visible: true,
        timeout: 60000,
      });

      debug("Submitting form");
      await page.click("input[type=submit]");

      await Bluebird.delay(500);

      debug("Waiting for submission to finish");
      await Promise.race([
        page.waitForSelector(
          `input[name=loginfmt].has-error,input[name=loginfmt].moveOffScreen`,
          { timeout: 60000 }
        ),
        (async (): Promise<void> => {
          await Bluebird.delay(1000);
          await page.waitForSelector(`input[name=loginfmt]`, {
            hidden: true,
            timeout: 60000,
          });
        })(),
      ]);
    },
  },
  {
    name: "account selection",
    selector: `#aadTile > div > div.table-cell.tile-img > img`,
    async handler(page: puppeteer.Page): Promise<void> {
      debug("Multiple accounts associated with username.");
      const aadTile = await page.$("#aadTileTitle");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const aadTileMessage: string = await page.evaluate(
        // eslint-disable-next-line
        (a) => a.textContent,
        aadTile
      );

      const msaTile = await page.$("#msaTileTitle");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const msaTileMessage: string = await page.evaluate(
        // eslint-disable-next-line
        (m) => m.textContent,
        msaTile
      );

      const accounts = [
        { message: aadTileMessage, selector: "#aadTileTitle" },
        { message: msaTileMessage, selector: "#msaTileTitle" },
      ];

      let account;
      if (accounts.length === 0) {
        throw new CLIError("No accounts found on account selection screen.");
      } else if (accounts.length === 1) {
        account = accounts[0];
      } else {
        debug("Asking user to choose account");
        console.log(
          "It looks like this Username is used with more than one account from Microsoft. Which one do you want to use?"
        );
        const answers = await inquirer.prompt([
          {
            name: "account",
            message: "Account:",
            type: "list",
            choices: _.map(accounts, "message"),
            default: aadTileMessage,
          } as Question,
        ]);

        account = _.find(accounts, ["message", answers.account]);
      }

      if (!account) {
        throw new Error("Unable to find account");
      }

      debug(`Proceeding with account ${account.selector}`);
      await page.click(account.selector);
      await Bluebird.delay(500);
    },
  },
  {
    name: "passwordless",
    selector: `input[value='Send notification']`,
    async handler(page: puppeteer.Page) {
      debug("Sending notification");
      // eslint-disable-next-line
      await page.click("input[value='Send notification']");
      debug("Waiting for auth code");
      // eslint-disable-next-line
      await page.waitForSelector(`#idRemoteNGC_DisplaySign`, {
        visible: true,
        timeout: 60000,
      });
      debug("Printing the message displayed");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const messageElement = await page.$(
        "#idDiv_RemoteNGC_PollingDescription"
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const codeElement = await page.$("#idRemoteNGC_DisplaySign");
      // eslint-disable-next-line
      const message = await page.evaluate(
        // eslint-disable-next-line
        (el) => el.textContent,
        messageElement
      );
      console.log(message);
      debug("Printing the auth code");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const authCode = await page.evaluate(
        // eslint-disable-next-line
        (el) => el.textContent,
        codeElement
      );
      console.log(authCode);
      debug("Waiting for response");
      await page.waitForSelector(`#idRemoteNGC_DisplaySign`, {
        hidden: true,
        timeout: 60000,
      });
    },
  },
  {
    name: "password input",
    selector: `input[name="Password"]:not(.moveOffScreen),input[name="passwd"]:not(.moveOffScreen)`,
    async handler(
      page: puppeteer.Page,
      _selected: puppeteer.ElementHandle,
      noPrompt: boolean,
      _defaultUsername: string,
      defaultPassword: string
    ): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorMessage = await page.evaluate(
          // eslint-disable-next-line
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
        defaultPassword = ""; // Password error. Unset the default and allow user to enter it.
      }

      let password;

      if (noPrompt && defaultPassword) {
        debug("Not prompting user for password");
        password = defaultPassword;
      } else {
        debug("Prompting user for password");
        ({ password } = await inquirer.prompt([
          {
            name: "password",
            message: "Password:",
            type: "password",
          } as Question,
        ]));
      }

      debug("Focusing on password input");
      await page.focus(`input[name="Password"],input[name="passwd"]`);

      debug("Typing password");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await page.keyboard.type(password);

      debug("Submitting form");
      await page.click("span[class=submit],input[type=submit]");

      debug("Waiting for a delay");
      await Bluebird.delay(500);
    },
  },
  {
    name: "TFA instructions",
    selector: `#idDiv_SAOTCAS_Description`,
    async handler(
      page: puppeteer.Page,
      selected: puppeteer.ElementHandle
    ): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const descriptionMessage = await page.evaluate(
        // eslint-disable-next-line
        (description) => description.textContent,
        selected
      );
      console.log(descriptionMessage);
      debug("Checking if authentication code is displayed");
      // eslint-disable-next-line
      if (descriptionMessage.includes("enter the number shown to sign in")) {
        const authenticationCodeElement = await page.$(
          "#idRichContext_DisplaySign"
        );
        debug("Reading the authentication code");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const authenticationCode = await page.evaluate(
          // eslint-disable-next-line
          (d) => d.textContent,
          authenticationCodeElement
        );
        debug("Printing the authentication code to console");
        console.log(authenticationCode);
      }
      debug("Waiting for response");
      await page.waitForSelector(`#idDiv_SAOTCAS_Description`, {
        hidden: true,
        timeout: 60000,
      });
    },
  },
  {
    name: "TFA failed",
    selector: `#idDiv_SAASDS_Description,#idDiv_SAASTO_Description`,
    async handler(
      page: puppeteer.Page,
      selected: puppeteer.ElementHandle
    ): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const descriptionMessage = await page.evaluate(
        // eslint-disable-next-line
        (description) => description.textContent,
        selected
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      throw new CLIError(descriptionMessage);
    },
  },
  {
    name: "TFA code input",
    selector: "input[name=otc]:not(.moveOffScreen)",
    async handler(page: puppeteer.Page): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const errorMessage = await page.evaluate(
          // eslint-disable-next-line
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
      } else {
        const description = await page.$("#idDiv_SAOTCC_Description");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const descriptionMessage = await page.evaluate(
          // eslint-disable-next-line
          (d) => d.textContent,
          description
        );
        console.log(descriptionMessage);
      }

      const { verificationCode } = await inquirer.prompt([
        {
          name: "verificationCode",
          message: "Verification Code:",
        } as Question,
      ]);

      debug("Focusing on verification code input");
      await page.focus(`input[name="otc"]`);

      debug("Clearing input");
      for (let i = 0; i < 100; i++) {
        await page.keyboard.press("Backspace");
      }

      debug("Typing verification code");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await page.keyboard.type(verificationCode);

      debug("Submitting form");
      await page.click("input[type=submit]");

      debug("Waiting for submission to finish");
      await Promise.race([
        page.waitForSelector(
          `input[name=otc].has-error,input[name=otc].moveOffScreen`,
          { timeout: 60000 }
        ),
        (async (): Promise<void> => {
          await Bluebird.delay(1000);
          await page.waitForSelector(`input[name=otc]`, {
            hidden: true,
            timeout: 60000,
          });
        })(),
      ]);
    },
  },
  {
    name: "Remember me",
    selector: `#KmsiDescription`,
    async handler(
      page: puppeteer.Page,
      _selected: puppeteer.ElementHandle,
      _noPrompt: boolean,
      _defaultUsername: string,
      _defaultPassword: string | undefined,
      rememberMe: boolean
    ): Promise<void> {
      if (rememberMe) {
        debug("Clicking remember me button");
        await page.click("#idSIButton9");
      } else {
        debug("Clicking don't remember button");
        await page.click("#idBtn_Back");
      }

      debug("Waiting for a delay");
      await Bluebird.delay(500);
    },
  },
  {
    name: "Service exception",
    selector: "#service_exception_message",
    async handler(
      page: puppeteer.Page,
      selected: puppeteer.ElementHandle
    ): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const descriptionMessage = await page.evaluate(
        // eslint-disable-next-line
        (description) => description.textContent,
        selected
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      throw new CLIError(descriptionMessage);
    },
  },
];

export const login = {
  async loginAsync(
    profileName: string,
    mode: string,
    disableSandbox: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    awsNoVerifySsl: boolean,
    enableChromeSeamlessSso: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<void> {
    let headless, cliProxy;
    if (mode === "cli") {
      headless = true;
      cliProxy = true;
    } else if (mode === "gui") {
      headless = false;
      cliProxy = false;
    } else if (mode === "debug") {
      headless = false;
      cliProxy = true;
    } else {
      throw new CLIError("Invalid mode");
    }

    const profile = await this._loadProfileAsync(profileName);
    let assertionConsumerServiceURL = AWS_SAML_ENDPOINT;
    if (profile.region && profile.region.startsWith("us-gov")) {
      assertionConsumerServiceURL = AWS_GOV_SAML_ENDPOINT;
    }
    if (profile.region && profile.region.startsWith("cn-")) {
      assertionConsumerServiceURL = AWS_CN_SAML_ENDPOINT;
    }

    console.log("Using AWS SAML endpoint", assertionConsumerServiceURL);

    const loginUrl = await this._createLoginUrlAsync(
      profile.azure_app_id_uri,
      profile.azure_tenant_id,
      assertionConsumerServiceURL
    );
    const samlResponse = await this._performLoginAsync(
      loginUrl,
      headless,
      disableSandbox,
      cliProxy,
      noPrompt,
      enableChromeNetworkService,
      profile.azure_default_username,
      profile.azure_default_password,
      enableChromeSeamlessSso,
      profile.azure_default_remember_me,
      noDisableExtensions,
      disableGpu
    );
    const roles = this._parseRolesFromSamlResponse(samlResponse);
    const { role, durationHours } = await this._askUserForRoleAndDurationAsync(
      roles,
      noPrompt,
      profile.azure_default_role_arn,
      profile.azure_default_duration_hours
    );

    await this._assumeRoleAsync(
      profileName,
      samlResponse,
      role,
      durationHours,
      awsNoVerifySsl,
      profile.region
    );
  },

  async loginAll(
    mode: string,
    disableSandbox: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    awsNoVerifySsl: boolean,
    enableChromeSeamlessSso: boolean,
    forceRefresh: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<void> {
    const profiles = await awsConfig.getAllProfileNames();

    if (!profiles) {
      return;
    }

    for (const profile of profiles) {
      debug(`Check if profile ${profile} is expired or is about to expire`);
      if (
        !forceRefresh &&
        !(await awsConfig.isProfileAboutToExpireAsync(profile))
      ) {
        debug(`Profile ${profile} not yet due for refresh.`);
        continue;
      }

      debug(`Run login for profile: ${profile}`);
      await this.loginAsync(
        profile,
        mode,
        disableSandbox,
        noPrompt,
        enableChromeNetworkService,
        awsNoVerifySsl,
        enableChromeSeamlessSso,
        noDisableExtensions,
        disableGpu
      );
    }
  },

  // Gather data from environment variables
  _loadProfileFromEnv(): { [key: string]: string } {
    const env: { [key: string]: string } = {};
    const options = [
      "azure_tenant_id",
      "azure_app_id_uri",
      "azure_default_username",
      "azure_default_password",
      "azure_default_role_arn",
      "azure_default_duration_hours",
    ];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const envVar = process.env[opt];
      const envVarUpperCase = process.env[opt.toUpperCase()];

      if (envVar) {
        env[opt] = envVar;
      } else if (envVarUpperCase) {
        env[opt] = envVarUpperCase;
      }
    }
    debug("Environment");
    debug({
      ...env,
      azure_default_password: "xxxxxxxxxx",
    });
    return env;
  },

  // Load the profile
  async _loadProfileAsync(profileName: string): Promise<ProfileConfig> {
    const profile = await awsConfig.getProfileConfigAsync(profileName);

    if (!profile)
      throw new CLIError(
        `Unknown profile '${profileName}'. You must configure it first with --configure.`
      );

    const env = this._loadProfileFromEnv();
    for (const prop in env) {
      if (env[prop]) {
        profile[prop] = env[prop] === null ? profile[prop] : env[prop];
      }
    }

    if (!profile.azure_tenant_id || !profile.azure_app_id_uri)
      throw new CLIError(
        `Profile '${profileName}' is not configured properly.`
      );

    console.log(`Logging in with profile '${profileName}'...`);
    return profile;
  },

  /**
   * Create the Azure login SAML URL.
   * @param {string} appIdUri - The app ID URI
   * @param {string} tenantId - The Azure tenant ID
   * @param {string} assertionConsumerServiceURL - The AWS SAML endpoint that Azure should send the SAML response to
   * @returns {string} The login URL
   * @private
   */
  _createLoginUrlAsync(
    appIdUri: string,
    tenantId: string,
    assertionConsumerServiceURL: string
  ): Promise<string> {
    debug("Generating UUID for SAML request");
    const id = v4();

    const samlRequest = `
        <samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="id${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" IsPassive="false" AssertionConsumerServiceURL="${assertionConsumerServiceURL}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
            <Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${appIdUri}</Issuer>
            <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"></samlp:NameIDPolicy>
        </samlp:AuthnRequest>
        `;
    debug("Generated SAML request", samlRequest);

    debug("Deflating SAML");

    return new Promise((resolve, reject) => {
      zlib.deflateRaw(samlRequest, (err, samlBuffer) => {
        if (err) {
          return reject(err);
        }

        debug("Encoding SAML in base64");
        const samlBase64 = samlBuffer.toString("base64");

        const url = `https://login.microsoftonline.com/${tenantId}/saml2?SAMLRequest=${encodeURIComponent(
          samlBase64
        )}`;
        debug("Created login URL", url);

        return resolve(url);
      });
    });
  },

  /**
   * Perform the login using Chrome.
   * @param {string} url - The login URL
   * @param {boolean} headless - True to hide the GUI, false to show it.
   * @param {boolean} disableSandbox - True to disable the Puppeteer sandbox.
   * @param {boolean} cliProxy - True to proxy input/output through the CLI, false to leave it in the GUI
   * @param {bool} [noPrompt] - Enable skipping of user prompting
   * @param {bool} [enableChromeNetworkService] - Enable chrome network service.
   * @param {string} [defaultUsername] - The default username
   * @param {string} [defaultPassword] - The default password
   * @param {bool} [enableChromeSeamlessSso] - chrome seamless SSO
   * @param {bool} [rememberMe] - Enable remembering the session
   * @param {bool} [noDisableExtensions] - True to prevent Puppeteer from disabling Chromium extensions
   * @param {bool} [disableGpu] - Disables GPU Acceleration
   * @returns {Promise.<string>} The SAML response.
   * @private
   */
  async _performLoginAsync(
    url: string,
    headless: boolean,
    disableSandbox: boolean,
    cliProxy: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    defaultUsername: string,
    defaultPassword: string | undefined,
    enableChromeSeamlessSso: boolean,
    rememberMe: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<string> {
    debug("Loading login page in Chrome");

    let browser: puppeteer.Browser | undefined;

    try {
      const args = headless
        ? []
        : [`--app=${url}`, `--window-size=${WIDTH},${HEIGHT}`];
      if (disableSandbox) args.push("--no-sandbox");
      if (enableChromeNetworkService)
        args.push("--enable-features=NetworkService");
      if (enableChromeSeamlessSso)
        args.push(
          `--auth-server-whitelist=${AZURE_AD_SSO}`,
          `--auth-negotiate-delegate-whitelist=${AZURE_AD_SSO}`
        );
      if (rememberMe) {
        await mkdirp(paths.chromium);
        args.push(`--user-data-dir=${paths.chromium}`);
      }

      if (process.env.https_proxy) {
        args.push(`--proxy-server=${process.env.https_proxy}`);
      }

      const ignoreDefaultArgs = noDisableExtensions
        ? ["--disable-extensions"]
        : [];

      if (disableGpu) {
        args.push("--disable-gpu");
      }

      browser = await puppeteer.launch({
        headless,
        args,
        ignoreDefaultArgs,
      });

      // Wait for a bit as sometimes the browser isn't ready.
      await Bluebird.delay(200);

      const pages = await browser.pages();
      const page = pages[0];
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en",
      });
      await page.setViewport({ width: WIDTH - 15, height: HEIGHT - 35 });

      // Prevent redirection to AWS
      let samlResponseData;
      const samlResponsePromise = new Promise((resolve) => {
        page.on("request", (req: HTTPRequest) => {
          const reqURL = req.url();
          debug(`Request: ${url}`);
          if (
            reqURL === AWS_SAML_ENDPOINT ||
            reqURL === AWS_GOV_SAML_ENDPOINT ||
            reqURL === AWS_CN_SAML_ENDPOINT
          ) {
            resolve(undefined);
            samlResponseData = req.postData();
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            req.respond({
              status: 200,
              contentType: "text/plain",
              headers: {},
              body: "",
            });
            if (browser) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              browser.close();
            }
            browser = undefined;
            debug(`Received SAML response, browser closed`);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            req.continue();
          }
        });
      });

      debug("Enabling request interception");
      await page.setRequestInterception(true);

      try {
        if (headless || (!headless && cliProxy)) {
          debug("Going to login page");
          await page.goto(url, { waitUntil: "domcontentloaded" });
        } else {
          debug("Waiting for login page to load");
          await page.waitForNavigation({ waitUntil: "networkidle0" });
        }
      } catch (err) {
        if (err instanceof Error) {
          // An error will be thrown if you're still logged in cause the page.goto ot waitForNavigation
          // will be a redirect to AWS. That's usually OK
          debug(`Error occured during loading the first page: ${err.message}`);
        }
      }

      if (cliProxy) {
        let totalUnrecognizedDelay = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (samlResponseData) break;

          let foundState = false;
          for (let i = 0; i < states.length; i++) {
            const state = states[i];

            let selected;
            try {
              selected = await page.$(state.selector);
            } catch (err) {
              if (err instanceof Error) {
                // An error can be thrown if the page isn't in a good state.
                // If one occurs, try again after another loop.
                debug(
                  `Error when running state "${
                    state.name
                  }". ${err.toString()}. Retrying...`
                );
              }
              break;
            }

            if (selected) {
              foundState = true;
              debug(`Found state: ${state.name}`);

              await Promise.race([
                samlResponsePromise,
                state.handler(
                  page,
                  selected,
                  noPrompt,
                  defaultUsername,
                  defaultPassword,
                  rememberMe
                ),
              ]);

              debug(`Finished state: ${state.name}`);

              break;
            }
          }

          if (foundState) {
            totalUnrecognizedDelay = 0;
          } else {
            debug("State not recognized!");
            if (totalUnrecognizedDelay > MAX_UNRECOGNIZED_PAGE_DELAY) {
              const path = "aws-azure-login-unrecognized-state.png";
              await page.screenshot({ path });
              throw new CLIError(
                `Unable to recognize page state! A screenshot has been dumped to ${path}. If this problem persists, try running with --mode=gui or --mode=debug`
              );
            }

            totalUnrecognizedDelay += DELAY_ON_UNRECOGNIZED_PAGE;
            await Bluebird.delay(DELAY_ON_UNRECOGNIZED_PAGE);
          }
        }
      } else {
        console.log("Please complete the login in the opened window");
        await samlResponsePromise;
      }

      if (!samlResponseData) {
        throw new Error("SAML response not found");
      }

      const samlResponse = querystring.parse(samlResponseData).SAMLResponse;

      debug("Found SAML response", samlResponse);

      if (!samlResponse) {
        throw new Error("SAML response not found");
      } else if (Array.isArray(samlResponse)) {
        throw new Error("SAML can't be an array");
      }

      return samlResponse;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },

  /**
   * Parse AWS roles out of the SAML response
   * @param {string} assertion - The SAML assertion
   * @returns {Array.<{roleArn: string, principalArn: string}>} The roles
   * @private
   */
  _parseRolesFromSamlResponse(assertion: string): Role[] {
    debug("Converting assertion from base64 to ASCII");
    const samlText = Buffer.from(assertion, "base64").toString("ascii");
    debug("Converted", samlText);

    debug("Parsing SAML XML");
    const saml = load(samlText, { xmlMode: true });

    debug("Looking for role SAML attribute");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const roles: Role[] = saml(
      "Attribute[Name='https://aws.amazon.com/SAML/Attributes/Role']>AttributeValue"
    )
      .map(function () {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const roleAndPrincipal = saml(this).text();
        const parts = roleAndPrincipal.split(",");

        // Role / Principal claims may be in either order
        const [roleIdx, principalIdx] = parts[0].includes(":role/")
          ? [0, 1]
          : [1, 0];
        const roleArn = parts[roleIdx].trim();
        const principalArn = parts[principalIdx].trim();
        return { roleArn, principalArn };
      })
      .get();
    debug("Found roles", roles);
    return roles;
  },

  /**
   * Ask the user for the role they want to use.
   * @param {Array.<{roleArn: string, principalArn: string}>} roles - The roles to pick from
   * @param {bool} [noPrompt] - Enable skipping of user prompting
   * @param {string} [defaultRoleArn] - The default role ARN
   * @param {number} [defaultDurationHours] - The default session duration in hours
   * @returns {Promise.<{role: string, durationHours: number}>} The selected role and duration
   * @private
   */
  async _askUserForRoleAndDurationAsync(
    roles: Role[],
    noPrompt: boolean,
    defaultRoleArn: string,
    defaultDurationHours: string
  ): Promise<{
    role: Role;
    durationHours: number;
  }> {
    let role;
    let durationHours = parseInt(defaultDurationHours, 10);
    const questions: QuestionCollection[] = [];
    if (roles.length === 0) {
      throw new CLIError("No roles found in SAML response.");
    } else if (roles.length === 1) {
      debug("Choosing the only role in response");
      role = roles[0];
    } else {
      if (noPrompt && defaultRoleArn) {
        role = _.find(roles, ["roleArn", defaultRoleArn]);
      }

      if (role) {
        debug("Valid role found. No need to ask.");
      } else {
        debug("Asking user to choose role");
        questions.push({
          name: "role",
          message: "Role:",
          type: "list",
          choices: _.sortBy(_.map(roles, "roleArn")),
          default: defaultRoleArn,
        });
      }
    }

    if (noPrompt && defaultDurationHours) {
      debug("Default durationHours found. No need to ask.");
    } else {
      questions.push({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: defaultDurationHours || 1,
        validate: (input): boolean | string => {
          input = Number(input);
          if (input > 0 && input <= 12) return true;
          return "Duration hours must be between 0 and 12";
        },
      });
    }

    // Don't prompt for questions if not needed, an unneeded TTYWRAP prevents node from exiting when
    // user is logged in and using multiple profiles --all-profiles and --no-prompt
    if (questions.length > 0) {
      const answers = await inquirer.prompt(questions);
      if (!role) role = _.find(roles, ["roleArn", answers.role]);
      if (answers.durationHours) {
        durationHours = parseInt(answers.durationHours as string, 10);
      }
    }

    if (!role) {
      throw new Error(`Unable to find role`);
    }

    return { role, durationHours };
  },

  /**
   * Assume the role.
   * @param {string} profileName - The profile name
   * @param {string} assertion - The SAML assertion
   * @param {string} role - The role to assume
   * @param {number} durationHours - The session duration in hours
   * @param {bool} awsNoVerifySsl - Whether to have the AWS CLI verify SSL
   * @param {string} region - AWS region, if specified
   * @returns {Promise} A promise
   * @private
   */
  async _assumeRoleAsync(
    profileName: string,
    assertion: string,
    role: Role,
    durationHours: number,
    awsNoVerifySsl: boolean,
    region: string
  ): Promise<void> {
    console.log(`Assuming role ${role.roleArn} in region ${region}...`);
    let stsOptions: STSClientConfig = {};
    if (process.env.https_proxy) {
      stsOptions = {
        ...stsOptions,
        requestHandler: new NodeHttpHandler({
          httpsAgent: proxy(process.env.https_proxy),
        }),
      };
    }

    if (awsNoVerifySsl) {
      stsOptions = {
        ...stsOptions,
        requestHandler: new NodeHttpHandler({
          httpsAgent: new Agent({
            rejectUnauthorized: false,
          }),
        }),
      };
    }

    if (region) {
      stsOptions = {
        ...stsOptions,
        region,
      };
    }

    const sts = new STS(stsOptions);
    const res = await sts.assumeRoleWithSAML({
      PrincipalArn: role.principalArn,
      RoleArn: role.roleArn,
      SAMLAssertion: assertion,
      DurationSeconds: Math.round(durationHours * 60 * 60),
    });

    if (!res.Credentials) {
      debug("Unable to get security credentials from AWS");
      return;
    }

    await awsConfig.setProfileCredentialsAsync(profileName, {
      aws_access_key_id: res.Credentials.AccessKeyId ?? "",
      aws_secret_access_key: res.Credentials.SecretAccessKey ?? "",
      aws_session_token: res.Credentials.SessionToken ?? "",
      aws_expiration: res.Credentials.Expiration?.toISOString() ?? "",
    });
  },
};

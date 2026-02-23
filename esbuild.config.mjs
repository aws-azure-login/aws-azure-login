import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  outfile: "./dist/aws-azure-login",
  external: ["puppeteer", "@aws-sdk/credential-provider-node"],
  minify: true,
  legalComments: "linked",
});

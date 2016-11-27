[![view on npm](http://img.shields.io/npm/v/aws-azure-login.svg)](https://www.npmjs.org/package/aws-azure-login)
[![npm module downloads per month](http://img.shields.io/npm/dm/aws-azure-login.svg)](https://www.npmjs.org/package/aws-azure-login)

# aws-azure-login
If your organization uses [Azure Active Directory](https://azure.microsoft.com) to provide SSO login to the AWS console, then there is no easy way to use the [AWS CLI](https://aws.amazon.com/cli/). This tool lets you use the normal Azure AD login (including MFA) from a command line to create a federated AWS session and places the temporary credentials in the proper place for the AWS CLI.

## Installation

You should first install the AWS CLI using the [installation instructions](http://docs.aws.amazon.com/cli/latest/userguide/installing.html). Then install aws-azure-login:

    $ npm install -g aws-azure-login

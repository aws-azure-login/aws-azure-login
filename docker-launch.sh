#!/usr/bin/env bash

docker run --rm -it -v ~/.aws:/root/.aws aws-azure-login/aws-azure-login "$@"

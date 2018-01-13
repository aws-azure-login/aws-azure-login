#!/usr/bin/env bash

docker run --rm -it -v ~/.aws:/root/.aws dtjohnson/aws-azure-login "$@"

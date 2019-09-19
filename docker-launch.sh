#!/usr/bin/env bash

docker run --rm -it -v ~/.aws:/root/.aws sportradar/aws-azure-login "$@"

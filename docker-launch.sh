#!/usr/bin/env bash

# Initiate local build of image, goes very quickly if already built
docker build . -t aws-azure-login

# Run the container using local image
docker run --rm -it -v ~/.aws:/root/.aws aws-azure-login "$@"

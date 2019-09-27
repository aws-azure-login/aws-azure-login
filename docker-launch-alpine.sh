#!/usr/bin/env bash

docker run -e "DEBUG=*" --rm -it \
  --entrypoint='' \
  -v ~/.aws:/root/.aws \
  -v ${PWD}:/aws-azure-login \
  aws-azure-login:alpine "$@" \
  sh

#!/usr/bin/env bash

docker run --rm -it -v ~/.aws:/root/.aws -e DISPLAY="${DISPLAY}" -v /tmp/.X11-unix:/tmp/.X11-unix sportradar/aws-azure-login "$@"

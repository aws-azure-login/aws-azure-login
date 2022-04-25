#!/bin/sh -l

node /aws-azure-login/lib --no-sandbox "$@"

if [ "$CI" = "true" ]; then
    output() {
        value=$(grep $1 < ~/.aws/credentials | head -1 | cut -d '=' -f2)
        echo "::add-mask::$value"
        echo "::set-output name=$1::$value"
    }
    output "aws_access_key_id"
    output "aws_secret_access_key"
    output "aws_session_token"
    output "aws_expiration"
fi

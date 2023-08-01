#!/bin/sh
NODE_OPTIONS='--inspect=9230 --inspect-port=0.0.0.0:9230' node --inspect=0.0.0.0:9234 $(which pnpm) --filter ai-adventure-app dev
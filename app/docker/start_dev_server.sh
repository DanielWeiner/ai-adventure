#!/bin/bash

function find_port () {
    local PORT_COMMAND="$1"
    local INCOMING_PORT="$2"

    while [ -z "$($PORT_COMMAND)" ]; do
        sleep 1
    done
    
    iptables -t nat -A PREROUTING -p tcp -m tcp --dport $INCOMING_PORT -j REDIRECT --to-port $($PORT_COMMAND)
}

function get_proxy_port () {
    netstat -tulpn | grep node | grep -v :923 | grep -v :3000 | awk '{print $4}' | sed 's/0.0.0.0://'
}

function get_npm_port () {
    netstat -tulpn | grep dev | awk '{print $4}' | sed 's/0.0.0.0://'
}

(find_port get_proxy_port 9230) &
(find_port get_npm_port 9234) &

NODE_OPTIONS='--inspect=9230 --inspect-port=0.0.0.0:0' npm run dev
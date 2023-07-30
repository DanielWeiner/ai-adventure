const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
    entry: path.resolve(__dirname, './server.ts'),
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    configFile: path.resolve(__dirname, 'tsconfig.json')
                }
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: 'server.js',
        path: path.resolve(__dirname, '.ai-queue')
    },
    name: 'ai-queue',
    
    mode: process.env.NODE_ENV  == 'production' ? 'production' : 'development',
    devtool: 'inline-source-map',
    externals: [ 
        nodeExternals({
            modulesDir: path.resolve(__dirname, './node_modules')   
        }),
        nodeExternals({
            modulesDir: path.resolve(__dirname, '../../node_modules'),
        })
    ],
    externalsPresets: { node: true }
};
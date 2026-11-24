// Staging must be provisioned explicitly; never silently clone production data.
const { spawn } = require('node:child_process');
const path = require('node:path');
process.env.NODE_ENV = 'staging';
require('../server/config/environment').validateProduction();
const child = spawn(process.execPath, [path.resolve(__dirname, '../server/server.js')], { env:process.env, stdio:'inherit', windowsHide:true });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code ?? 1;});

import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'
import { missingWorkerVars } from './dev-stack-config.mjs'
try{await access('.dev.vars',constants.R_OK)}catch{console.error('Configuration locale absente : copiez .dev.vars.example vers .dev.vars et renseignez les valeurs localement. Aucun secret ne doit être commité.');process.exit(1)}
const vars=await readFile('.dev.vars','utf8'),missing=missingWorkerVars(vars)
if(missing.length){console.error('Variables manquantes dans .dev.vars : '+missing.join(', ')+'. Les valeurs ne sont jamais affichées.');process.exit(1)}
const npm=process.platform==='win32'?'npm.cmd':'npm',children=[];let stopping=false
function start(args){const child=spawn(npm,args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});children.push(child);child.once('exit',code=>{if(!stopping){stopping=true;for(const other of children)if(other!==child)other.kill('SIGTERM');process.exitCode=code??1}});return child}
function ready(){return new Promise(resolve=>{const socket=net.connect(8787,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>{socket.destroy();resolve(false)})})}
const worker=start(['run','worker:dev']);let available=false
for(let i=0;i<60&&!stopping;i++){await delay(500);if(await ready()){available=true;break}}
if(!available){console.error('Worker local absent après 30 s; Vite ne démarre pas. Consultez les erreurs Wrangler ci-dessus.');stopping=true;worker.kill('SIGTERM');process.exitCode=1}
else start(['run','dev','--','--host','0.0.0.0'])
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;for(const child of children)child.kill(signal)})

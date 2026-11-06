import { spawn } from 'node:child_process'
const npm=process.platform==='win32'?'npm.cmd':'npm'
const child=spawn(npm,['run','dev','--','--host','0.0.0.0'],{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,VITE_NUTRIPERSO_UI_FIXTURES:'1'}})
child.once('exit',code=>{process.exitCode=code??1})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))

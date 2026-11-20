const {buildSync}=require('esbuild'),Module=require('node:module'),path=require('node:path');
const filename=path.resolve('src/shared/i18n.ts');
const output=buildSync({entryPoints:[filename],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(output,filename);
module.exports=loaded.exports;

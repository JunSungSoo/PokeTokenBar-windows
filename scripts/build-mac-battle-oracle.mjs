import{readFile,mkdir,writeFile,copyFile}from'node:fs/promises';import{resolve,join}from'node:path';import{execFileSync}from'node:child_process';
const reference=resolve(process.argv[2]??'../PokeTokenBar'),out=resolve(process.argv[3]??'/private/tmp/poketokenbar-battle-parity');await mkdir(out,{recursive:true});
const models=await readFile(join(reference,'Sources/PokeTokenBar/Core/Battle/BattleModels.swift'),'utf8'),coordinator=await readFile(join(reference,'Sources/PokeTokenBar/Core/Battle/BattleCoordinator.swift'),'utf8');
function block(source,marker){const start=source.indexOf(marker);if(start<0)throw Error(marker);let end=source.indexOf('{',start)+1,depth=1;while(depth){const char=source[end++];if(char==='{')depth++;if(char==='}')depth--;}return source.slice(start,end);}
const code=`import Foundation\nimport CryptoKit\n${block(models,'struct BattleAction:')}\n${block(models,'struct BattleDecision:')}\nenum Original {${block(coordinator,'static func digest(')}}\nstruct Input:Decodable{let decision:BattleDecision;let nonce:String;let matchID:String}\n@main struct Oracle{static func main()throws{let rows=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile());let result=rows.map{Original.digest($0.decision,nonce:$0.nonce,matchID:$0.matchID)};FileHandle.standardOutput.write(try JSONEncoder().encode(result))}}`;
if(process.platform==='darwin'){
 await writeFile(join(out,'Oracle.swift'),code);execFileSync('swiftc',['-parse-as-library','-module-cache-path',join(out,'module-cache'),join(out,'Oracle.swift'),'-o',join(out,'oracle')],{stdio:'inherit'});
}else{
 // Apple's Swift Crypto provides the CryptoKit SHA256 API on Linux. The original
 // BattleAction, BattleDecision and digest bodies above remain unmodified.
 const portable=join(out,'portable'),sources=join(portable,'Sources/Oracle');await mkdir(sources,{recursive:true});
 await writeFile(join(sources,'Oracle.swift'),code.replace('import CryptoKit','import Crypto'));
 await writeFile(join(portable,'Package.swift'),'// swift-tools-version: 6.0\nimport PackageDescription\nlet package=Package(name:"BattleOracle",products:[.executable(name:"oracle",targets:["Oracle"])],dependencies:[.package(url:"https://github.com/apple/swift-crypto.git",exact:"3.10.0")],targets:[.executableTarget(name:"Oracle",dependencies:[.product(name:"Crypto",package:"swift-crypto")])])\n');
 execFileSync('swift',['build','--package-path',portable,'-c','release','--jobs','4','--product','oracle',...(process.env.POKE_OFFLINE==='1'?['--disable-automatic-resolution']:[])],{stdio:'inherit'});
 await copyFile(join(portable,'.build/release/oracle'),join(out,'oracle'));
}
console.log(join(out,'oracle'));

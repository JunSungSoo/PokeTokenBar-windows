// Match the reference form IDs and the same PokéAPI language preferences as macOS.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readMacSource,macReferenceRef} from '../tests/mac-reference.mjs';
const source=readMacSource('Sources/PokeTokenBar/Core/PokemonForm.swift');
const url='https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_form_names.csv';
const response=await fetch(url);if(!response.ok)throw Error('Form names download failed: '+response.status);const csv=await response.text();
function fields(line){const values=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===','&&!quoted){values.push(value);value='';}else value+=char;}values.push(value);return values;}
const byID=new Map();for(const line of csv.trim().split(/\r?\n/).slice(1)){const [id,language,name]=fields(line);if(name){const row=byID.get(Number(id))??{};row[language]=name;byID.set(Number(id),row);}}
const preferences={ko:[3],en:[9],ja:[1,11],es:[7],fr:[5],pt:[],de:[6],ru:[]},names={};
for(const block of source.matchAll(/(\d+): \[([\s\S]*?)\],/g)){
 const species=Number(block[1]);if(species===493||species===201)continue;
 for(const entry of block[2].matchAll(/\.init\("([^"]+)", formID: (\d+)/g)){
  const [_,form,id]=entry,row=byID.get(Number(id))??{};
  if(form==='normal'&&[351,479,646,649].includes(species))continue;
  (names[species]??={})[form]=Object.fromEntries(Object.entries(preferences).map(([language,ids])=>[language,ids.map(id=>row[id]).find(Boolean)??row[9]??form]));
 }
}
await writeFile('src/companion-data/form-names.json',JSON.stringify(names)+'\n');
await writeFile('src/companion-data/form-names-source.json',JSON.stringify({reference:macReferenceRef,url,sha256:createHash('sha256').update(csv).digest('hex')},null,2)+'\n');
console.log('Localized '+Object.values(names).reduce((sum,forms)=>sum+Object.keys(forms).length,0)+' forms');

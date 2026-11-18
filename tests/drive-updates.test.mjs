import test from 'node:test';import assert from 'node:assert/strict';
import {driveShareURL,driveRelease,releaseVersion,newerVersion,windowsZipVersion,windowsDriveURL}from'../dist/shared/drive-release.js';
import {DriveReleaseSource}from'../dist/main/drive-updates.js';
const html=(version='1.0.1')=>`<title>PokeTokenBar-Windows-${version}.zip - Google Drive</title>`;
const response=version=>new Response(html(version),{headers:{'content-type':'text/html; charset=utf-8'}});
test('Windows Drive filenames accept releases and reject Mac, other architectures and prereleases',()=>{
 for(const file of ['PokeTokenBar-Windows-1.0.0.zip','PokeTokenBar-Windows-1.0.0-x64.zip','PokeTokenBar-Windows-1.0.0-x64-20261116-settings.zip','PokeTokenBar-Windows-1.0.0-20261116(2).zip'])assert.equal(windowsZipVersion(file),'1.0.0');
 for(const file of ['PokeTokenBar-9.0.0-arm64.zip','PokeTokenBar-Windows-9.0.0-arm64.zip','PokeTokenBar-Windows-1.0.0-beta.zip','PokeTokenBar-Windows-1.0.0.exe','PokeTokenBar-Windows-1.0.0.zip.exe'])assert.equal(windowsZipVersion(file),undefined);
 assert.equal(driveRelease(html(),windowsDriveURL).version,'1.0.1');assert.equal(driveRelease('<title>Sign in - Google Drive</title>',windowsDriveURL),undefined);assert.equal(driveRelease('<title>PokeTokenBar-Windows-1.0.0-20261116&#40;2&#41;.zip - Google Drive</title>',windowsDriveURL).version,'1.0.0');
});
test('versions compare three numeric components, starting at 1.0.0',()=>{
 assert.equal(newerVersion('1.0.10','1.0.9'),true);assert.equal(newerVersion('1.0.0','1.0.0'),false);assert.equal(newerVersion('0.9.9','1.0.0'),false);assert.equal(newerVersion('2.0.0','1.99.99'),true);assert.equal(releaseVersion(' V001.02.0003 '),'1.2.3');for(const tag of ['1.0','1.0.0-beta.1','1.0.0+build','1.0.0.1','1.0.-1','1000000000.0.0'])assert.equal(releaseVersion(tag),undefined);
});
test('only HTTPS Drive file shares normalize into a download destination',()=>{
 assert.equal(driveShareURL(windowsDriveURL+'?usp=sharing'),windowsDriveURL);for(const url of ['http://drive.google.com/file/d/1234567890/view','https://drive.google.com.evil.test/file/d/1234567890/view','https://user@drive.google.com/file/d/1234567890/view','https://drive.google.com/drive/folders/1234567890','file:///tmp/app.zip'])assert.equal(driveShareURL(url),undefined);
});
test('Drive checks deduplicate, cache successful checks for 30 minutes and retry failures immediately',async()=>{
 let calls=0,now=0,fail=true;const source=new DriveReleaseSource(async(_url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');if(fail)throw Error('offline');await new Promise(r=>setTimeout(r,5));return response('1.0.1');},()=>now);
 await assert.rejects(source.check(windowsDriveURL),/offline/);fail=false;const [a,b]=await Promise.all([source.check(windowsDriveURL),source.check(windowsDriveURL)]);assert.deepEqual(a,b);assert.equal(calls,2);now=1799999;await source.check(windowsDriveURL);assert.equal(calls,2);now=1800000;await source.check(windowsDriveURL);assert.equal(calls,3);await source.check(windowsDriveURL,0);assert.equal(calls,4);
});
test('non-public, unsupported and oversized responses are rejected and do not start cooldown',async()=>{
 for(const first of [new Response('denied',{status:403}),new Response(html(),{headers:{'content-type':'application/zip'}}),new Response(html(),{headers:{'content-type':'text/html','content-length':'1048577'}}),new Response('x'.repeat(1048577),{headers:{'content-type':'text/html'}}),new Response('<title>PokeTokenBar-9.0.0-arm64.zip - Google Drive</title>',{headers:{'content-type':'text/html'}})]){let count=0;const source=new DriveReleaseSource(async()=>++count===1?first:response('1.0.1'));await assert.rejects(source.check(windowsDriveURL));assert.equal((await source.check(windowsDriveURL)).version,'1.0.1');assert.equal(count,2);}
});

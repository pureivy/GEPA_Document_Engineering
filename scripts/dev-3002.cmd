@echo off
chcp 65001 >nul
title GEPA dev 3002
cd /d "%~dp0.."
set ALLOWED_DEV_ORIGINS=192.168.1.101,100.107.71.5,s-pc,s-pc.taile2a385.ts.net
npx next dev -H 0.0.0.0 -p 3002

# ============================================================
#  Skills Manager 构建脚本（中文化）
#  - 选项 1：调试启动（tauri dev，热重载）
#  - 选项 2：打包发布（tauri build，生成 MSI/EXE）
#  - 3 秒后自动执行选项 1
# ============================================================

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Skills Manager" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [1] 调试启动 (tauri dev, 热重载)" -ForegroundColor White
Write-Host "  [2] 打包发布 (tauri build, MSI/EXE)" -ForegroundColor White
Write-Host ""
Write-Host "3秒后自动执行 [1] 调试启动, 按键选择:" -ForegroundColor Yellow
Write-Host "  输入 1 = 调试启动" -ForegroundColor Gray
Write-Host "  输入 2 = 打包发布" -ForegroundColor Gray
Write-Host ""

# 3 秒倒计时，期间按键则立即响应
$choice = "1"
$start = Get-Date
while (((Get-Date) - $start).TotalSeconds -lt 3) {
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true).KeyChar
        if ($key -eq "1" -or $key -eq "2") {
            $choice = $key
            break
        }
    }
    Start-Sleep -Milliseconds 100
}

Write-Host ""
Write-Host "  ==> 执行选项$choice" -ForegroundColor Green
Write-Host ""

if ($choice -eq "1") {
    # ── 调试启动 ──
    Write-Host "==> 调试启动 (热重载)" -ForegroundColor Cyan
    Write-Host "  前端: Vite dev server" -ForegroundColor Gray
    Write-Host "  后端: Cargo debug" -ForegroundColor Gray
    Write-Host "  改代码自动刷新, Ctrl+C 停止" -ForegroundColor Gray
    Write-Host ""

    # 检查前端依赖是否已安装
    if (-not (Test-Path "node_modules")) {
        Write-Host "==> 未发现 node_modules, 先安装前端依赖..." -ForegroundColor Yellow
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "==> 前端依赖安装失败!" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "==> 检查前端依赖..." -ForegroundColor Gray
        pnpm install --frozen-lockfile 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "==> 锁文件不一致, 重新安装..." -ForegroundColor Yellow
            pnpm install
        }
    }
    Write-Host ""

    Write-Host "==> 启动 tauri dev..." -ForegroundColor Cyan
    Write-Host ""
    pnpm tauri:dev
}
elseif ($choice -eq "2") {
    # ── 打包发布 ──
    Write-Host "==> 打包发布 (生成安装包)" -ForegroundColor Cyan
    Write-Host "  前端: Vite 生产构建" -ForegroundColor Gray
    Write-Host "  后端: Cargo release 编译" -ForegroundColor Gray
    Write-Host "  产物: src-tauri/target/release/bundle/" -ForegroundColor Gray
    Write-Host ""

    # 检查前端依赖
    if (-not (Test-Path "node_modules")) {
        Write-Host "==> 未发现 node_modules, 先安装前端依赖..." -ForegroundColor Yellow
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "==> 前端依赖安装失败!" -ForegroundColor Red
            exit 1
        }
        Write-Host ""
    }

    Write-Host "==> 先构建前端 (tsc + vite build)..." -ForegroundColor Cyan
    pnpm build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==> 前端构建失败! 请检查 TypeScript 错误。" -ForegroundColor Red
        exit 1
    }
    Write-Host ""

    Write-Host "==> 启动 tauri build (release 编译, 可能需要较长时间)..." -ForegroundColor Cyan
    Write-Host ""
    pnpm tauri:build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==> 打包失败!" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "==> 打包完成!" -ForegroundColor Green
    Write-Host "  安装包位置:" -ForegroundColor Gray
    $bundleDir = "src-tauri/target/release/bundle"
    if (Test-Path $bundleDir) {
        Get-ChildItem -Path $bundleDir -Recurse -Include "*.msi","*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "    $($_.FullName)" -ForegroundColor White
        }
    }
    Write-Host ""

    # 询问是否打开产物目录
    Write-Host "是否打开产物目录? (Y/N, 3秒后默认 N)" -ForegroundColor Yellow
    $openChoice = "N"
    $openStart = Get-Date
    while (((Get-Date) - $openStart).TotalSeconds -lt 3) {
        if ([Console]::KeyAvailable) {
            $k = [Console]::ReadKey($true).KeyChar.ToString().ToUpper()
            if ($k -eq "Y" -or $k -eq "N") {
                $openChoice = $k
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    if ($openChoice -eq "Y" -and (Test-Path $bundleDir)) {
        Invoke-Item -Path $bundleDir
    }
}

Write-Host ""
Write-Host "==> 脚本结束" -ForegroundColor Cyan

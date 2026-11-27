import path from 'node:path';

export const intelTest = process.env.NARUTO_BUILD_TARGET === 'intel-test';
const intelBuildRoot = process.env.NARUTO_INTEL_BUILD_DIR;

if (intelTest && (!intelBuildRoot || !path.isAbsolute(intelBuildRoot))) {
  throw new Error('NARUTO_BUILD_TARGET=intel-test requires an absolute NARUTO_INTEL_BUILD_DIR');
}

export const distDir = intelTest ? path.join(intelBuildRoot, 'dist') : 'dist';
export const gameSpeedDir = intelTest ? path.join(intelBuildRoot, 'game-speed') : 'assets/game-speed';
export const macOSDeploymentTarget = intelTest ? '12.0' : '15.0';
export const nativeTarget = intelTest
  ? 'x86_64-apple-macos12.0'
  : `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos15.0`;

export const swiftTargetArgs = ['-target', nativeTarget];
export const embeddedLoginSwiftTargetArgs = ['-target', `x86_64-apple-macos${macOSDeploymentTarget}`];
export const clangTargetArgs = ['-arch', 'x86_64', ...(intelTest ? ['-mmacosx-version-min=12.0'] : [])];
export const gameSpeedArchArgs = intelTest
  ? clangTargetArgs
  : ['-arch', 'arm64', '-arch', 'x86_64'];
export const installNameArgs = fileName => intelTest
  ? ['-Xlinker', '-install_name', '-Xlinker', `@rpath/${fileName}`]
  : [];

process.env.MACOSX_DEPLOYMENT_TARGET = macOSDeploymentTarget;

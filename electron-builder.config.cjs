const path = require('node:path');
const rawUpdateUrl = process.env.ANT_UPDATE_URL?.trim();
let updateUrl = '';

if (rawUpdateUrl) {
  const parsed = new URL(rawUpdateUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('ANT_UPDATE_URL must use HTTPS.');
  }
  updateUrl = `${rawUpdateUrl.replace(/\/+$/, '')}/`;
}

module.exports = {
  appId: 'com.antcolony.desktop',
  productName: '蚁群',
  artifactName: 'AntColony-${version}-Setup.${ext}',
  directories: {
    output: 'dist'
  },
  electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist'),
  asar: true,
  electronLanguages: ['zh-CN', 'en-US'],
  extraMetadata: {
    antUpdateUrl: updateUrl
  },
  files: [
    'main.js',
    'preload.js',
    'desktop-icons.ps1',
    'desktop-focus.ps1',
    'desktop-probe.cs',
    'wallpaper-patches.cs',
    'renderer/**/*',
    'assets/**/*',
    'package.json',
    '!renderer/ant-renderer.bundle.js',
    '!renderer/ant-renderer.js',
    '!renderer/ant-model.js'
  ],
  ...(updateUrl ? {
    publish: [{ provider: 'generic', url: updateUrl }]
  } : {}),
  // Pin the modern toolsets so local and CI builds resolve the same binaries.
  // The build command supplies ELECTRON_BUILDER_BINARIES_MIRROR when GitHub is unavailable.
  toolsets: {
    nsis: '1.2.1',
    winCodeSign: '1.1.0'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/ant-icon.ico',
    // Keep the app icon and version metadata on unsigned local builds.
    signAndEditExecutable: true,
    ...(process.env.ANT_PUBLISHER_NAME ? {
      publisherName: [process.env.ANT_PUBLISHER_NAME.trim()]
    } : {})
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '蚁群',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true
  },
  portable: {
    artifactName: 'AntColony-${version}-Portable.${ext}'
  }
};

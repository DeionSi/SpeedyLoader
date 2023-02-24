const { app, BrowserWindow, ipcMain, shell } = require('electron')
const {download} = require('electron-dl')
const {execFile} = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');
const Store = require('electron-store');
const configStore = new Store();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

var avrdudeErr = "";
var avrdudeIsRunning = false;
var teensyLoaderIsRunning = false;
var teensyLoaderErr = ""

function createWindow () 
{
  // Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 600,
    backgroundColor: '#312450',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Open links in external browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // auto hide menu bar (Win, Linux)
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);

  // remove completely when app is packaged (Win, Linux)
  if (app.isPackaged) {
    win.removeMenu();
  }

  // and load the index.html of the app.
  win.loadFile('index.html')

  // Open the DevTools.
  //win.webContents.openDevTools()

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null
  })

}

//Required for newer versions of Electron to work with serialport
app.allowRendererProcessReuse = false


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  //if (process.platform !== 'darwin') 
  {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow()
  }
})

ipcMain.on('downloadFWfiles', (e, args) => {
  
  ( async () => {
    
    let configProperty = ['versions', args.version].join('.');
    let dlDir = path.join(app.getPath('userData'), 'firmwareVersions', args.version);

    // Remove old files for this version
    try {
      fs.readdirSync(dlDir).forEach(file => {
        file = path.join(dlDir, file);
        if (fs.lstatSync(file).isFile() && (path.extname(file) === '.hex' || path.extname(file) === '.ini')) {
          fs.unlinkSync(file)
        }
      });
    }
    catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    configStore.delete(configProperty); // files have been deleted, remove from config store

    // Download all files to this firmware version
    let DLurls = [
      "https://speeduino.com/fw/teensy35/" + args.version + "-teensy35.hex",
      "https://speeduino.com/fw/teensy36/" + args.version + "-teensy36.hex",
      "https://speeduino.com/fw/teensy41/" + args.version + "-teensy41.hex",
      "https://speeduino.com/fw/bin/" + args.version + ".hex",
      "https://speeduino.com/fw/" + args.version + ".ini"
    ];

    let savedFiles = [];
    for (const DLurl of DLurls) {

      console.log("Downloading firmware: " + DLurl);
      let savedFile = await downloadFileToFolder(DLurl, dlDir);
      savedFiles.push(savedFile);
      console.log("downloadFWfiles " + savedFile);

    };

    if (savedFiles.length > 0) {
      configStore.set(configProperty, savedFiles);
    }

    e.sender.send("downloadFWcomplete");
  })();
    
});

ipcMain.handle('getVersionDownloadStatus', (e, args) => {
  return getVersionDownloadStatus(args.version);
});

function getVersionDownloadStatus(version) {

  let configProperty = ['versions', version].join('.');
  let versionFiles = configStore.get(configProperty);
  //console.log(versionFiles);
  let downloadStatus;

  if (typeof versionFiles === 'undefined') { downloadStatus = "not downloaded"; }
  else if (versionFiles.length === 0) { downloadStatus = "not downloaded"; }
  else
  {
    let filesFound = 0;
    for (const file of versionFiles) {
      if (fs.existsSync(file)) { filesFound++; }
    }

    if (filesFound == versionFiles.length) { downloadStatus = "downloaded"; }
    else if (filesFound == 0) {
      downloadStatus = "not downloaded";
      configStore.delete(configProperty); // files have been deleted, remove from config store
    }
    else {
      downloadStatus = "partially downloaded";
    }
  }

  return downloadStatus;
}

async function downloadFileToFolder(argsUrl, dlDir) {

  let parsed = url.parse(argsUrl);
  let filename = path.basename(parsed.pathname);

  let savedFile;

  await download(BrowserWindow.getFocusedWindow(), argsUrl, { directory: dlDir } )
    .then(dl => { savedFile = dl.getSavePath() } )
    .catch(console.error);

  return savedFile;
}

ipcMain.on('download', (e, args) => {
  downloadFile(args.url, args.version);
});

function downloadFile(argsUrl, dlDir) {
  console.log(argsUrl);

  let parsed = url.parse(argsUrl);
  let filename = path.basename(parsed.pathname);

  dlDir = path.join(app.getPath('userData'), version);
  fullFile = path.join(dlDir, filename);

  //console.log("Filename: " + fullFile );
  let options = {};
  if(filename.split('.').pop() == "msq")
  {
    options = { saveAs: true };
  }
  else {
    options = { directory: dlDir };
  }

  let savedFile;
  download(BrowserWindow.getFocusedWindow(), argsUrl, options)
    .then(dl => { savedFile = dl.getSavePath() } )
    .catch(console.error);

  return savedFile;
}

ipcMain.on('installWinDrivers', (e, args) => {
  var infName = __dirname + "/bin/drivers-win/arduino.inf";
  infName = infName.replace('app.asar',''); 
  console.log("INF File " + infName);
   //syssetup,SetupInfObjectInstallAction DefaultInstall 128 .\<file>.inf

  var execArgs = ['syssetup,SetupInfObjectInstallAction', 'DefaultInstall 128', infName];

  const child = execFile("rundll32", execArgs);

});

ipcMain.on('uploadFW', (e, args) => {

  if(avrdudeIsRunning == true) { return; }
  avrdudeIsRunning = true; //Indicate that an avrdude process has started
  var platform;

  var burnStarted = false;
  var burnPercent = 0;

  //All Windows builds use the 32-bit binary
  if(process.platform == "win32") 
  { 
    platform = "avrdude-windows"; 
  }
  //All Mac builds use the 64-bit binary
  else if(process.platform == "darwin") 
  { 
    platform = "avrdude-darwin-x86_64";
  }
  else if(process.platform == "linux") 
  { 
    if(process.arch == "x32") { platform = "avrdude-linux_i686"; }
    else if(process.arch == "x64") { platform = "avrdude-linux_x86_64"; }
    else if(process.arch == "arm") { platform = "avrdude-armhf"; }
    else if(process.arch == "arm64") { platform = "avrdude-aarch64"; }
  }

  var executableName = __dirname + "/bin/" + platform + "/avrdude";
  executableName = executableName.replace('app.asar',''); //This is important for allowing the binary to be found once the app is packaed into an asar
  var configName = executableName + ".conf";
  if(process.platform == "win32") { executableName = executableName + '.exe'; } //This must come after the configName line above

  var hexFile = 'flash:w:' + args.firmwareFile + ':i';

  var execArgs = ['-v', '-patmega2560', '-C', configName, '-cwiring', '-b 115200', '-P', args.port, '-D', '-U', hexFile];

  console.log(executableName);
  const child = execFile(executableName, execArgs);

  child.stdout.on('data', (data) => {
    console.log(`avrdude stdout:\n${data}`);
  });

  child.stderr.on('data', (data) => {
    console.log(`avrdude stderr: ${data}`);
    avrdudeErr = avrdudeErr + data;

    //Check if avrdude has started the actual burn yet, and if so, track the '#' characters that it prints. Each '#' represents 1% of the total burn process (50 for write and 50 for read)
    if (burnStarted == true)
    {
      if(data=="#") { burnPercent += 1; }
      e.sender.send( "upload percent", burnPercent );
    }
    else
    {
      //This is a hack, but basically watch the output from avrdude for the term 'Writing | ', everything after that is the #s indicating 1% of burn. 
      if(avrdudeErr.substr(avrdudeErr.length - 10) == "Writing | ")
      {
        burnStarted = true;
      }
    }
  });

  child.on('error', (err) => {
    console.log('Failed to start subprocess.');
    console.log(err);
    avrDudeIsRunning = false;
  });

  child.on('close', (code) => {
    avrdudeIsRunning = false;
    if (code !== 0) 
    {
      console.log(`avrdude process exited with code ${code}`);
      e.sender.send( "upload error", avrdudeErr )
      avrdudeErr = "";
    }
    else
    {
      e.sender.send( "upload completed", code )
    }
  });

});

  ipcMain.on('uploadFW_teensy', (e, args) => {

    if(teensyLoaderIsRunning == true) { return; }
    teensyLoaderIsRunning = true; //Indicate that an avrdude process has started
    var platform;
  
    var burnStarted = false;
    var burnPercent = 0;
  
    //All Windows builds use the 32-bit binary
    if(process.platform == "win32") 
    { 
      platform = "teensy_loader_cli-windows"; 
    }
    //All Mac builds use the 64-bit binary
    else if(process.platform == "darwin") 
    { 
      platform = "teensy_loader_cli-darwin-x86_64";
    }
    else if(process.platform == "linux") 
    { 
      if(process.arch == "x32") { platform = "teensy_loader_cli-linux_i686"; }
      else if(process.arch == "x64") { platform = "teensy_loader_cli-linux_x86_64"; }
      else if(process.arch == "arm") { platform = "teensy_loader_cli-armhf"; }
      else if(process.arch == "arm64") { platform = "teensy_loader_cli-aarch64"; }
    }
  
    var executableName = __dirname + "/bin/" + platform + "/teensy_post_compile";
    executableName = executableName.replace('app.asar',''); //This is important for allowing the binary to be found once the app is packaed into an asar
    var configName = executableName + ".conf";
    
  
    var execArgs = ['-board='+args.board, '-reboot', '-file='+path.basename(args.firmwareFile, '.hex'), '-path='+path.dirname(args.firmwareFile), '-tools='+executableName.replace('/teensy_post_compile', "")];
    //console.log(execArgs);
  
    if(process.platform == "win32") { executableName = executableName + '.exe'; } //This must come after the configName line above
    
    console.log(executableName);
    const child = execFile(executableName, execArgs);
  
    child.stdout.on('data', (data) => {
      console.log(`teensy_loader_cli stdout:\n${data}`);
    });
  
    child.stderr.on('data', (data) => {
      console.log(`teensy_loader_cli stderr: ${data}`);
      teensyLoaderErr = teensyLoaderErr + data;
  
      //Check if avrdude has started the actual burn yet, and if so, track the '#' characters that it prints. Each '#' represents 1% of the total burn process (50 for write and 50 for read)
      if (burnStarted == true)
      {
        if(data=="#") { burnPercent += 1; }
        e.sender.send( "upload percent", burnPercent );
      }
      else
      {
        //This is a hack, but basically watch the output from teensy loader for the term 'Writing | ', everything after that is the #s indicating 1% of burn. 
        if(teensyLoaderErr.substr(teensyLoaderErr.length - 10) == "Writing | ")
        {
          burnStarted = true;
        }
      }
      
    });

  child.on('error', (err) => {
    console.log('Failed to start subprocess.');
    console.log(err);
    teensyLoaderIsRunning = false;
  });

  child.on('close', (code) => {
    teensyLoaderIsRunning = false;
    if (code !== 0) 
    {
      console.log(`teensyLoader process exited with code ${code}`);
      e.sender.send( "upload error", teensyLoaderErr )
      teensyLoaderErr = "";
    }
    else
    {
      e.sender.send( "upload completed", code )
    }
  });
});

ipcMain.handle('getAppVersion', async (e) => {
  return app.getVersion();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('show-ini', (event, location) => {
  if (location.endsWith('.ini'))
  {
      shell.showItemInFolder(location); // This function needs to be executed in main.js to bring file explorer to foreground
  }
});
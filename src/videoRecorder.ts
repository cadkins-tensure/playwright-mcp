/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import https from 'https';
import { createWriteStream } from 'fs';
import extract from 'extract-zip';

import * as playwright from 'playwright';
import { logUnhandledError } from './utils/log.js';
import { outputFile } from './config.js';

import type { FullConfig } from './config.js';

import type { Context } from './context.js';

export interface VideoRecordingOptions {
  format: 'webm' | 'mp4';
  quality: 'low' | 'medium' | 'high';
  frameRate: number;
  fullPage: boolean;
  screenshotInterval: number;
}

export class VideoRecorder {
  private _config: FullConfig;
  private _options: VideoRecordingOptions;
  private _outputDir: string;
  private _screenshotsDir: string;
  private _videoFile: string;
  private _isRecording = false;
  private _screenshotInterval: NodeJS.Timeout | null = null;
  private _screenshotCount = 0;
  private _context: Context | null = null;
  private _ffmpegPath: string | null = null;
  private _sessionId: string | null = null;
  private static _sessionCounter = 0;

  constructor(config: FullConfig, options: VideoRecordingOptions, outputDir: string) {
    this._config = config;
    this._options = options;
    this._outputDir = outputDir;
    // Initialize with placeholder paths - will be set when recording starts
    this._screenshotsDir = '';
    this._videoFile = '';
  }

  static async create(config: FullConfig, rootPath: string | undefined): Promise<VideoRecorder | null> {
    if (!config.videoRecording?.enabled)
      return null;

    // Create base output directory - session folders will be created in startRecording
    const outputDir = await outputFile(config, rootPath, 'video-sessions');
    await fs.promises.mkdir(outputDir, { recursive: true });

    const options = {
      format: 'webm' as const,
      quality: 'medium' as const,
      frameRate: 5, // Reduced from 10 to 5 for more natural playback
      fullPage: false,
      screenshotInterval: 2000, // Increased from 1000 to 2000ms for slower capture
      ...config.videoRecording.options,
    };

    const recorder = new VideoRecorder(config, options, outputDir);
    return recorder;
  }

  async startRecording(context: Context): Promise<void> {
    if (this._isRecording)
      return;

    // Ensure FFmpeg is available before starting recording
    await this._ensureFFmpegAvailable();

    // Create unique session folder for this recording
    const sessionNumber = ++VideoRecorder._sessionCounter;
    this._sessionId = `session-${Date.now()}-${process.pid}-${sessionNumber}-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(this._outputDir, this._sessionId);
    this._screenshotsDir = path.join(sessionDir, 'screenshots');
    this._videoFile = path.join(sessionDir, `recording-${this._sessionId}.${this._options.format}`);

    await fs.promises.mkdir(this._screenshotsDir, { recursive: true });

    this._context = context;
    this._isRecording = true;
    this._screenshotCount = 0;

    // Start capturing screenshots at regular intervals
    this._screenshotInterval = setInterval(() => {
      void this._captureScreenshot();
    }, this._options.screenshotInterval);
  }

  async stopRecording(): Promise<string> {
    if (!this._isRecording)
      throw new Error('No active recording to stop');

    this._isRecording = false;

    if (this._screenshotInterval) {
      clearInterval(this._screenshotInterval);
      this._screenshotInterval = null;
    }

    // Generate video from screenshots
    const videoPath = await this._generateVideo();

    // Reset session data
    this._sessionId = null;
    this._screenshotsDir = '';
    this._videoFile = '';
    this._context = null;

    return videoPath;
  }

  async pauseRecording(): Promise<void> {
    if (!this._isRecording)
      return;

    if (this._screenshotInterval) {
      clearInterval(this._screenshotInterval);
      this._screenshotInterval = null;
    }
  }

  async resumeRecording(): Promise<void> {
    if (!this._isRecording || this._screenshotInterval)
      return;

    this._screenshotInterval = setInterval(() => {
      void this._captureScreenshot();
    }, this._options.screenshotInterval);
  }

  public triggerScreenshot(): void {
    if (this._isRecording) {
      void this._captureScreenshot();
    }
  }

  private async _ensureFFmpegAvailable(): Promise<void> {
    if (this._ffmpegPath) {
      return; // Already resolved
    }

    // 1. Check environment variable first (highest priority)
    const envFFmpegPath = process.env.FFMPEG_PATH || process.env.FFMPEG_BINARY;
    if (envFFmpegPath) {
      try {
        await fs.promises.access(envFFmpegPath, fs.constants.X_OK);
        this._ffmpegPath = envFFmpegPath;
        return;
      } catch (error) {
        throw new Error(`FFmpeg path from environment variable is not executable: ${envFFmpegPath}\nPlease check your FFMPEG_PATH or FFMPEG_BINARY environment variable.`);
      }
    }

    // 2. Auto-detect FFmpeg in system PATH
    const systemFFmpegPath = await this._findFFmpegInPath();
    if (systemFFmpegPath) {
      this._ffmpegPath = systemFFmpegPath;
      return;
    }

    // 3. Auto-download FFmpeg (fallback)
    try {
      this._ffmpegPath = await this._downloadFFmpeg();
      return;
    } catch (error) {
      const errorMessage = this._getFFmpegInstallationInstructions();
      throw new Error(`FFmpeg is required for video recording but could not be found or downloaded.\n\n${errorMessage}`);
    }
  }

  private async _findFFmpegInPath(): Promise<string | null> {
    const platform = process.platform;
    const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    // Check common PATH locations
    const pathDirs = process.env.PATH?.split(path.delimiter) || [];
    
    for (const dir of pathDirs) {
      try {
        const ffmpegPath = path.join(dir, binaryName);
        await fs.promises.access(ffmpegPath, fs.constants.X_OK);
        return ffmpegPath;
      } catch (error) {
        // Continue to next directory
      }
    }

    // Also check common installation locations
    const commonPaths = this._getCommonFFmpegPaths();
    for (const commonPath of commonPaths) {
      try {
        await fs.promises.access(commonPath, fs.constants.X_OK);
        return commonPath;
      } catch (error) {
        // Continue to next path
      }
    }

    return null;
  }

  private _getCommonFFmpegPaths(): string[] {
    const platform = process.platform;
    const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const paths: string[] = [];

    if (platform === 'darwin') {
      // macOS common locations
      paths.push(
        '/usr/local/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        path.join(process.env.HOME || '', 'homebrew/bin/ffmpeg')
      );
    } else if (platform === 'linux') {
      // Linux common locations
      paths.push(
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/opt/ffmpeg/bin/ffmpeg'
      );
    } else if (platform === 'win32') {
      // Windows common locations
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      paths.push(
        path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(programFilesX86, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe'
      );
    }

    return paths;
  }

  private _getFFmpegInstallationInstructions(): string {
    const platform = process.platform;
    
    let instructions = 'To install FFmpeg:\n\n';
    
    if (platform === 'darwin') {
      instructions += 'macOS:\n';
      instructions += '1. Using Homebrew: brew install ffmpeg\n';
      instructions += '2. Or download from: https://ffmpeg.org/download.html#build-mac\n';
      instructions += '3. Or set FFMPEG_PATH environment variable to your ffmpeg binary\n\n';
    } else if (platform === 'linux') {
      instructions += 'Linux:\n';
      instructions += '1. Ubuntu/Debian: sudo apt update && sudo apt install ffmpeg\n';
      instructions += '2. CentOS/RHEL: sudo yum install ffmpeg\n';
      instructions += '3. Or download from: https://ffmpeg.org/download.html#build-linux\n';
      instructions += '4. Or set FFMPEG_PATH environment variable to your ffmpeg binary\n\n';
    } else if (platform === 'win32') {
      instructions += 'Windows:\n';
      instructions += '1. Download from: https://ffmpeg.org/download.html#build-windows\n';
      instructions += '2. Extract and add to PATH, or\n';
      instructions += '3. Set FFMPEG_PATH environment variable to your ffmpeg.exe\n\n';
    }

    instructions += 'Environment Variables:\n';
    instructions += '- Set FFMPEG_PATH to the full path to your ffmpeg binary\n';
    instructions += '- Example: export FFMPEG_PATH=/usr/local/bin/ffmpeg\n';
    instructions += '- Or in your MCP configuration, add to env: { "FFMPEG_PATH": "/path/to/ffmpeg" }\n\n';
    
    instructions += 'MCP Configuration Example:\n';
    instructions += '{\n';
    instructions += '  "playwright": {\n';
    instructions += '    "command": "node",\n';
    instructions += '    "args": ["/path/to/playwright-mcp/cli.js", "--save-video"],\n';
    instructions += '    "env": {\n';
    instructions += '      "FFMPEG_PATH": "/usr/local/bin/ffmpeg"\n';
    instructions += '    }\n';
    instructions += '  }\n';
    instructions += '}';

    return instructions;
  }

  private async _downloadFFmpeg(): Promise<string> {
    const platform = process.platform;
    const arch = process.arch;
    const cacheDir = path.join(process.cwd(), '.ffmpeg-cache');
    await fs.promises.mkdir(cacheDir, { recursive: true });

    let ffmpegUrl: string;
    let ffmpegFilename: string;

    if (platform === 'darwin') {
      if (arch === 'arm64') {
        ffmpegUrl = 'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-macos-arm64.zip';
        ffmpegFilename = 'ffmpeg-macos-arm64';
      } else {
        ffmpegUrl = 'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-macos-x86_64.zip';
        ffmpegFilename = 'ffmpeg-macos-x86_64';
      }
    } else if (platform === 'linux') {
      if (arch === 'x64') {
        ffmpegUrl = 'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-linux-x86_64.zip';
        ffmpegFilename = 'ffmpeg-linux-x86_64';
      } else if (arch === 'arm64') {
        ffmpegUrl = 'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-linux-aarch64.zip';
        ffmpegFilename = 'ffmpeg-linux-aarch64';
      } else {
        throw new Error(`Unsupported architecture: ${arch} on ${platform}`);
      }
    } else if (platform === 'win32') {
      if (arch === 'x64') {
        ffmpegUrl = 'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-windows-x86_64.zip';
        ffmpegFilename = 'ffmpeg-windows-x86_64.exe';
      } else {
        throw new Error(`Unsupported architecture: ${arch} on ${platform}`);
      }
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const ffmpegPath = path.join(cacheDir, ffmpegFilename);

    // Check if already downloaded
    try {
      await fs.promises.access(ffmpegPath, fs.constants.X_OK);
      return ffmpegPath;
    } catch (error) {
      // File doesn't exist or not executable, download it
    }

    const zipPath = path.join(cacheDir, `${ffmpegFilename}.zip`);

    // Download the zip file
    await this._downloadFile(ffmpegUrl, zipPath);

    // Extract the zip file
    await this._extractZip(zipPath, cacheDir);

    // Make executable (on Unix systems)
    if (platform !== 'win32')
      await fs.promises.chmod(ffmpegPath, 0o755);

    // Clean up zip file
    await fs.promises.unlink(zipPath);

    return ffmpegPath;
  }

  private async _downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      https.get(url, response => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', err => {
        fs.promises.unlink(destPath).catch(() => {}); // Clean up on error
        reject(err);
      });
    });
  }

  private async _extractZip(zipPath: string, destDir: string): Promise<void> {
    try {
      await extract(zipPath, { dir: destDir });
    } catch (error) {
      // Fallback: try to extract manually for common cases
      await this._extractZipManually(zipPath, destDir);
    }
  }

  private async _extractZipManually(zipPath: string, destDir: string): Promise<void> {
    // This is a simplified manual extraction for common FFmpeg zip structures
    // In practice, you'd want to use a proper zip library like 'unzipper' or 'extract-zip'

    // For now, we'll just copy the binary directly if it's not zipped
    const platform = process.platform;

    let binaryName = 'ffmpeg';
    if (platform === 'win32')
      binaryName = 'ffmpeg.exe';


    // Try to find the binary in the zip (this is a simplified approach)
    const possiblePaths = [
      path.join(destDir, binaryName),
      path.join(destDir, 'bin', binaryName),
      path.join(destDir, 'ffmpeg', 'bin', binaryName),
    ];

    for (const possiblePath of possiblePaths) {
      try {
        await fs.promises.access(possiblePath);
        // Found it, make it executable
        if (platform !== 'win32')
          await fs.promises.chmod(possiblePath, 0o755);

        return;
      } catch (error) {
        // Continue to next path
      }
    }

    throw new Error('Could not extract FFmpeg binary from zip file');
  }

  private async _captureScreenshot(): Promise<void> {

    if (!this._context || !this._isRecording)
      return;


    try {
      const currentTab = this._context.currentTab();
      if (!currentTab)
        return;


      const screenshotCount = ++this._screenshotCount;
      const filename = `screenshot-${screenshotCount.toString().padStart(6, '0')}.png`;
      const filepath = path.join(this._screenshotsDir, filename);


      // Check if page is still valid
      if (currentTab.page.isClosed()) {
        this._isRecording = false;
        return;
      }


      const options: playwright.PageScreenshotOptions = {
        type: 'png',
        path: filepath,
        fullPage: this._options.fullPage,
      };

      await currentTab.page.screenshot(options);

      // Verify the file was actually created
      try {
        await fs.promises.stat(filepath);
      } catch (statError) {
      }
    } catch (error) {
      logUnhandledError(error);
    }
  }

  private async _generateVideo(): Promise<string> {
    const screenshots = await fs.promises.readdir(this._screenshotsDir);
    const pngFiles = screenshots.filter(file => file.endsWith('.png')).sort();


    if (pngFiles.length === 0)
      throw new Error('No screenshots found to create video');


    // List all screenshot files to verify they exist
    for (const file of pngFiles) {
      const filepath = path.join(this._screenshotsDir, file);
      try {
        await fs.promises.stat(filepath);
      } catch (error) {
      }
    }

    // Use FFmpeg to create video from screenshots
    // The screenshots are named screenshot-000001.png, screenshot-000002.png, etc.
    const inputPattern = path.join(this._screenshotsDir, 'screenshot-%06d.png');


    // Use a simpler FFmpeg command for testing
    const ffmpegArgs = [
      '-framerate', '1', // Input framerate: 1 FPS (one screenshot per second)
      '-i', inputPattern,
      '-r', '5', // Output framerate: 5 FPS for smooth playback
      '-c:v', 'libvpx', // Use simpler codec for testing
      '-crf', '30', // Lower quality for testing
      '-pix_fmt', 'yuv420p',
      '-y', // Overwrite output file
      this._videoFile
    ];


    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this._ffmpegPath!, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';

      ffmpeg.stdout.on('data', data => {
        // stdout data ignored
      });

      ffmpeg.stderr.on('data', data => {
        stderr += data.toString();
      });

      ffmpeg.on('close', code => {
        if (code === 0) {

          // Check if video file was actually created and has content
          fs.promises.stat(this._videoFile).then(stats => {
          }).catch(error => {
          });

          resolve(this._videoFile);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', error => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }

  private _getVideoCodec(): string {
    return this._options.format === 'webm' ? 'libvpx-vp9' : 'libx264';
  }

  private _getQualitySetting(): string {
    switch (this._options.quality) {
      case 'low': return '28';
      case 'high': return '18';
      default: return '23';
    }
  }

  private async _cleanupScreenshots(): Promise<void> {
    try {
      // Temporarily disabled screenshot cleanup for debugging
      // await fs.promises.rm(this._screenshotsDir, { recursive: true, force: true });
    } catch (error) {
      logUnhandledError(error);
    }
  }

  isRecording(): boolean {
    return this._isRecording;
  }

  getVideoFile(): string {
    return this._videoFile;
  }
}

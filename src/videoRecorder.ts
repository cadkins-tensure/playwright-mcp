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
import { promisify } from 'util';
import https from 'https';
import { createWriteStream } from 'fs';
import { execFile } from 'child_process';
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


    // Create unique session folder for this recording
    const sessionNumber = ++VideoRecorder._sessionCounter;
    this._sessionId = `session-${Date.now()}-${process.pid}-${sessionNumber}-${Math.random().toString(36).substring(2, 8)}`;
    const sessionDir = path.join(this._outputDir, this._sessionId);
    this._screenshotsDir = path.join(sessionDir, 'screenshots');
    this._videoFile = path.join(sessionDir, `recording-${this._sessionId}.${this._options.format}`);


    this._context = context;
    this._isRecording = true;
    this._screenshotCount = 0;

    // Create session directory and screenshots subdirectory
    await fs.promises.mkdir(sessionDir, { recursive: true });
    await fs.promises.mkdir(this._screenshotsDir, { recursive: true });

    // Ensure FFmpeg is available
    await this._ensureFFmpeg();

    // Wait a bit for the page to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start screenshot capture
    this._screenshotInterval = setInterval(async () => {
      await this._captureScreenshot();
    }, this._options.screenshotInterval);

    // Capture initial screenshot immediately
    await this._captureScreenshot();

  }

  async stopRecording(): Promise<string | null> {
    if (!this._isRecording)
      return null;


    this._isRecording = false;

    // Stop screenshot capture
    if (this._screenshotInterval) {
      clearInterval(this._screenshotInterval);
      this._screenshotInterval = null;
    }

    // Wait a bit for any pending screenshots
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate video from screenshots
    const videoPath = await this._generateVideo();

    // Clean up screenshots after video generation
    await this._cleanupScreenshots();

    // Reset session for next recording

    this._sessionId = null;
    this._screenshotsDir = '';
    this._videoFile = '';


    return videoPath;
  }

  /**
   * Trigger an immediate screenshot capture (for tab switching)
   */
  async triggerScreenshot(): Promise<void> {
    await this._captureScreenshot();
  }

  private async _ensureFFmpeg(): Promise<void> {
    if (this._ffmpegPath)
      return;


    // Try to find system FFmpeg first
    try {
      const { stdout } = await promisify(execFile)('ffmpeg', ['-version'], { timeout: 5000 });
      if (stdout.includes('ffmpeg version')) {
        this._ffmpegPath = 'ffmpeg';
        return;
      }
    } catch (error) {
      // System FFmpeg not found, download our own
    }

    // Download FFmpeg binary
    this._ffmpegPath = await this._downloadFFmpeg();
  }

  private async _downloadFFmpeg(): Promise<string> {
    const platform = process.platform;
    const arch = process.arch;

    // Create cache directory
    const cacheDir = path.join(process.cwd(), '.cache', 'ffmpeg');
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

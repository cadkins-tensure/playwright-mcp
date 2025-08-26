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

import { z } from 'zod';
import { defineTool } from './tool.js';

const recordingStartSchema = z.object({
  format: z.enum(['webm', 'mp4']).optional().describe('Video format. Defaults to webm.'),
  quality: z.enum(['low', 'medium', 'high']).optional().describe('Video quality. Defaults to medium.'),
  frameRate: z.number().optional().describe('Frame rate (fps). Defaults to 10.'),
  fullPage: z.boolean().optional().describe('Record full page instead of just viewport. Defaults to false.'),
  screenshotInterval: z.number().optional().describe('Screenshot interval in milliseconds. Defaults to 1000.'),
});

const recordingStopSchema = z.object({});

const recordingPauseSchema = z.object({});

const recordingStart = defineTool({
  capability: 'video',
  schema: {
    name: 'recording_start',
    title: 'Start recording',
    description: 'Start recording a video of the browser session. Requires video recording to be enabled in configuration.',
    inputSchema: recordingStartSchema,
    type: 'readOnly',
  },

  handle: async (context, params, response) => {

    if (!context.videoRecorder)
      throw new Error('Video recording is not enabled. Use --save-video flag to enable video recording.');


    if (context.videoRecorder.isRecording())
      throw new Error('Video recording is already in progress.');

    try {
      await context.videoRecorder.startRecording(context);

      response.addCode(`// Started video recording`);
      response.addResult(`Started video recording. Video will be saved as: ${context.videoRecorder.getVideoFile()}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide helpful instructions if FFmpeg is not found
      if (errorMessage.includes('FFmpeg is required') || errorMessage.includes('FFmpeg path')) {
        response.addError(`Failed to start video recording: ${errorMessage}\n\nTo fix this:\n1. Install FFmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)\n2. Or set FFMPEG_PATH environment variable in your MCP configuration\n3. Or the system will attempt to auto-download FFmpeg`);
        return;
      }
      
      response.addError(`Failed to start video recording: ${errorMessage}`);
    }
  }
});

const recordingStop = defineTool({
  capability: 'video',
  schema: {
    name: 'recording_stop',
    title: 'Stop recording',
    description: 'Stop recording video and generate the final video file.',
    inputSchema: recordingStopSchema,
    type: 'readOnly',
  },

  handle: async (context, params, response) => {

    if (!context.videoRecorder) {
      response.addError('Video recording is not enabled.');
      return;
    }


    if (!context.videoRecorder.isRecording()) {
      response.addError('No video recording is currently in progress.');
      return;
    }

    const videoPath = await context.videoRecorder.stopRecording();

    response.addCode(`// Stopped video recording`);
    response.addResult(`Video recording completed. Video saved as: ${videoPath}`);
  }
});

const recordingPause = defineTool({
  capability: 'video',
  schema: {
    name: 'recording_pause',
    title: 'Pause recording',
    description: 'Pause video recording temporarily.',
    inputSchema: recordingPauseSchema,
    type: 'readOnly',
  },

  handle: async (context, params, response) => {

    if (!context.videoRecorder) {
      response.addError('Video recording is not enabled.');
      return;
    }


    if (!context.videoRecorder.isRecording()) {
      response.addError('No video recording is currently in progress.');
      return;
    }

    // For now, we'll just stop recording since pause isn't implemented yet
    const videoPath = await context.videoRecorder.stopRecording();

    response.addCode(`// Paused video recording`);
    response.addResult(`Video recording paused. Video saved as: ${videoPath}`);
  }
});

export default [
  recordingStart,
  recordingStop,
  recordingPause,
];

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

import { test, expect } from './fixtures.js';

test.describe('Video Recording Demo', () => {
  test('demonstrate video recording functionality', async ({ startClient, server }, testInfo) => {
    const outputDir = testInfo.outputPath('output');

    const { client } = await startClient({
      args: ['--save-video', `--output-dir=${outputDir}`],
    });

    // Check if video recording tools are available
    const tools = await client.listTools();
    const videoTools = tools.tools.filter(tool => tool.name.includes('recording'));
    expect(videoTools.length).toBeGreaterThan(0);
    expect(videoTools.map(t => t.name)).toContain('recording_start');
    expect(videoTools.map(t => t.name)).toContain('recording_stop');

    // Navigate to test page
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.HELLO_WORLD } });

    // Start video recording
    const startResponse = await client.callTool({ name: 'recording_start', arguments: {} });
    expect(startResponse.result).toContain('Started video recording');

    // Wait for some activity
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Stop video recording
    const stopResponse = await client.callTool({ name: 'recording_stop', arguments: {} });
    expect(stopResponse.result).toContain('Video recording completed');
  });
});

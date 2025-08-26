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
/* eslint-disable no-console */
import { test, expect } from './fixtures.js';

test.describe('Video Recording Stderr Debug', () => {
  test('capture stderr output for video recording', async ({ startClient, server }, testInfo) => {
    const outputDir = testInfo.outputPath('output');
    console.error('🔍 STDOUT: Starting video recording stderr debug test...');

    const { client, stderr } = await startClient({
      args: ['--save-video', `--output-dir=${outputDir}`],
    });

    console.error('🔍 STDOUT: Connected to MCP server');

    // Check stderr output
    const stderrOutput = stderr();
    console.error('🔍 STDOUT: Initial stderr output:', stderrOutput);

    // Check if video recording tools are available
    const tools = await client.listTools();
    const videoTools = tools.tools.filter(tool => tool.name.includes('recording'));
    expect(videoTools.length).toBeGreaterThan(0);
    console.error('🔍 STDOUT: Available video tools:', videoTools.map(t => t.name));

    console.error('🔍 STDOUT: Navigating to test page...');
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.HELLO_WORLD } });

    // Wait a bit for the page to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check stderr output after navigation
    const stderrAfterNav = stderr();
    console.error('🔍 STDOUT: Stderr after navigation:', stderrAfterNav);

    console.error('🔍 STDOUT: Checking if recording is already in progress...');
    const startResponse = await client.callTool({ name: 'recording_start', arguments: {} });
    console.error('🔍 STDOUT: Start response:', JSON.stringify(startResponse, null, 2));

    // Check stderr output after start
    const stderrAfterStart = stderr();
    console.error('🔍 STDOUT: Stderr after start:', stderrAfterStart);

    // Wait for some time to capture screenshots
    console.error('🔍 STDOUT: Waiting 5 seconds to capture screenshots...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check stderr output after waiting
    const stderrAfterWait = stderr();
    console.error('🔍 STDOUT: Stderr after waiting:', stderrAfterWait);

    console.error('🔍 STDOUT: Stopping video recording...');
    const stopResponse = await client.callTool({ name: 'recording_stop', arguments: {} });
    console.error('🔍 STDOUT: Stop response:', JSON.stringify(stopResponse, null, 2));

    // Check final stderr output
    const finalStderr = stderr();
    console.error('🔍 STDOUT: Final stderr output:', finalStderr);

    console.error('🔍 STDOUT: Video recording stderr debug completed!');
  });
});

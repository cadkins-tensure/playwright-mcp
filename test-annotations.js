import { spawn } from 'child_process';

async function testAnnotationSystem() {
  console.log('Testing annotation system...');
  
  // Test 1: Start recording
  console.log('\n1. Starting recording...');
  const startResult = await callMCPMethod('recording_start', {
    format: 'webm',
    quality: 'medium',
    frameRate: 5,
    fullPage: false,
    screenshotInterval: 2000
  });
  console.log('Start result:', startResult);
  
  // Test 2: Navigate to a page
  console.log('\n2. Navigating to example.com...');
  const navigateResult = await callMCPMethod('browser_navigate', {
    url: 'https://example.com'
  });
  console.log('Navigate result:', navigateResult);
  
  // Test 3: Add annotation
  console.log('\n3. Adding annotation...');
  const annotateResult = await callMCPMethod('recording_annotate_frame', {
    frameNumber: 5,
    text: 'TEST ANNOTATION - This should be visible!',
    position: 'top-left',
    style: {
      backgroundColor: 'rgba(255,0,0,0.8)',
      textColor: 'white',
      fontSize: 16
    }
  });
  console.log('Annotate result:', annotateResult);
  
  // Test 4: Stop recording
  console.log('\n4. Stopping recording...');
  const stopResult = await callMCPMethod('recording_stop', {});
  console.log('Stop result:', stopResult);
}

function callMCPMethod(method, params) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify(params);
    const cmd = `npx @modelcontextprotocol/inspector --config test-mcp-config.json --server playwright --cli --method ${method} --input '${input}'`;
    
    console.log(`Executing: ${cmd}`);
    
    const child = spawn('npx', [
      '@modelcontextprotocol/inspector',
      '--config', 'test-mcp-config.json',
      '--server', 'playwright',
      '--cli',
      '--method', method,
      '--input', input
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          resolve({ success: true, output: stdout });
        }
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

testAnnotationSystem().catch(console.error);

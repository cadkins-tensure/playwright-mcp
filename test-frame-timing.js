import fs from 'fs';

// Simulate the frame timing issue in VideoRecorder
class MockVideoRecorder {
  constructor() {
    this._currentFrameNumber = 0;
    this._frameAnnotations = new Map();
    this._startTime = Date.now();
  }

  getCurrentFrameNumber() {
    return this._currentFrameNumber;
  }

  getCurrentFrameInfo() {
    return {
      frameNumber: this._currentFrameNumber,
      elapsedTime: Math.round((Date.now() - this._startTime) / 1000)
    };
  }

  addFrameAnnotation(params) {
    const annotation = {
      frameNumber: params.frameNumber,
      text: params.text,
      position: params.position || 'bottom-right',
      style: params.style || { 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        textColor: 'white', 
        fontSize: 14 
      }
    };
    
    if (!this._frameAnnotations.has(params.frameNumber)) {
      this._frameAnnotations.set(params.frameNumber, []);
    }
    this._frameAnnotations.get(params.frameNumber).push(annotation);
    
    console.log(`[DEBUG] Added annotation to frame ${params.frameNumber}: "${params.text}"`);
    console.log(`[DEBUG] Current frame number: ${this._currentFrameNumber}`);
    console.log(`[DEBUG] All annotations:`, Object.fromEntries(this._frameAnnotations));
  }

  captureScreenshot() {
    // Simulate the _captureScreenshot method
    const frameAnnotations = this._frameAnnotations.get(this._currentFrameNumber) || [];
    
    console.log(`[DEBUG] Capturing screenshot for frame ${this._currentFrameNumber}, found ${frameAnnotations.length} annotations`);
    
    if (frameAnnotations.length > 0) {
      console.log(`[DEBUG] Annotations found:`, frameAnnotations.map(a => a.text));
    } else {
      console.log(`[DEBUG] No annotations found for frame ${this._currentFrameNumber}`);
    }
    
    // Increment frame counter (this was the issue!)
    this._currentFrameNumber++;
  }
}

async function testFrameTiming() {
  console.log('Testing frame timing issue...\n');
  
  const recorder = new MockVideoRecorder();
  
  // Simulate the flow:
  // 1. Start recording (frame 0)
  console.log('1. Starting recording...');
  console.log(`Current frame: ${recorder.getCurrentFrameNumber()}`);
  
  // 2. Capture first screenshot (frame 0 -> 1)
  console.log('\n2. Capturing first screenshot...');
  recorder.captureScreenshot();
  console.log(`Current frame after screenshot: ${recorder.getCurrentFrameNumber()}`);
  
  // 3. Add annotation to frame 1
  console.log('\n3. Adding annotation to frame 1...');
  recorder.addFrameAnnotation({
    frameNumber: 1,
    text: 'This annotation should be found!',
    position: 'top-left',
    style: { backgroundColor: 'rgba(255,0,0,0.8)', textColor: 'white', fontSize: 16 }
  });
  
  // 4. Capture second screenshot (frame 1 -> 2)
  console.log('\n4. Capturing second screenshot...');
  recorder.captureScreenshot();
  console.log(`Current frame after screenshot: ${recorder.getCurrentFrameNumber()}`);
  
  // 5. Add annotation to current frame (2)
  console.log('\n5. Adding annotation to current frame (2)...');
  recorder.addFrameAnnotation({
    frameNumber: 2,
    text: 'This annotation should also be found!',
    position: 'top-right',
    style: { backgroundColor: 'rgba(0,255,0,0.8)', textColor: 'white', fontSize: 16 }
  });
  
  // 6. Capture third screenshot (frame 2 -> 3)
  console.log('\n6. Capturing third screenshot...');
  recorder.captureScreenshot();
  console.log(`Current frame after screenshot: ${recorder.getCurrentFrameNumber()}`);
  
  console.log('\n=== SUMMARY ===');
  console.log('The issue was that annotations were being added to specific frame numbers,');
  console.log('but by the time screenshots were captured, the frame number had already incremented.');
  console.log('This caused annotations to be "missed" during screenshot capture.');
}

testFrameTiming();

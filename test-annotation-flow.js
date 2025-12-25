import sharp from 'sharp';
import fs from 'fs';

// Simulate the exact annotation flow from VideoRecorder
async function testAnnotationFlow() {
  console.log('Testing annotation flow...');
  
  try {
    // Simulate a screenshot (create a test image)
    const testScreenshot = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
    
    console.log('Created test screenshot, size:', testScreenshot.length);
    
    // Simulate annotations (like the ones being saved to JSON)
    const annotations = [
      {
        frameNumber: 5,
        text: 'TEST ANNOTATION - This should be visible!',
        position: 'top-left',
        style: {
          backgroundColor: 'rgba(255,0,0,0.8)',
          textColor: 'white',
          fontSize: 16
        }
      }
    ];
    
    console.log('Annotations to add:', annotations);
    
    // Simulate the _addAnnotationsToImage method
    const annotatedScreenshot = await addAnnotationsToImage(testScreenshot, annotations, 5);
    
    console.log('Annotated screenshot size:', annotatedScreenshot.length);
    
    // Save both for comparison
    await fs.promises.writeFile('test-screenshot-original.png', testScreenshot);
    await fs.promises.writeFile('test-screenshot-annotated.png', annotatedScreenshot);
    
    console.log('Test completed! Check test-screenshot-original.png and test-screenshot-annotated.png');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Simulate the _addAnnotationsToImage method from VideoRecorder
async function addAnnotationsToImage(screenshot, annotations, currentFrameNumber) {
  try {
    console.log(`[DEBUG] Adding annotations to frame ${currentFrameNumber}, ${annotations.length} annotations`);
    
    // If no annotations, just return the original screenshot
    if (annotations.length === 0) {
      console.log(`[DEBUG] No annotations to add, returning original screenshot`);
      return screenshot;
    }
    
    let image = sharp(screenshot);
    
    // Get image metadata for proper positioning
    const metadata = await image.metadata();
    const imageWidth = metadata.width || 1920;
    const imageHeight = metadata.height || 1080;
    
    console.log(`[DEBUG] Image dimensions: ${imageWidth}x${imageHeight}`);
    
    // Add frame number and timestamp
    const timestamp = new Date().toLocaleTimeString();
    const frameText = `Frame ${currentFrameNumber} - ${timestamp}`;
    
    const frameTextSvg = `<svg width="400" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="40" fill="rgba(0,0,0,0.7)" rx="4"/>
      <text x="10" y="25" font-family="Arial, sans-serif" font-size="16" fill="white">${frameText}</text>
    </svg>`;
    console.log(`[DEBUG] Adding frame text: ${frameText}`);
    
    try {
      image = image.composite([{
        input: Buffer.from(frameTextSvg),
        top: 10,
        left: 10
      }]);
      console.log(`[DEBUG] Frame text composite successful`);
    } catch (compositeError) {
      console.error(`[ERROR] Frame text composite failed:`, compositeError);
    }
    
    // Add annotations
    for (const annotation of annotations) {
      console.log(`[DEBUG] Adding annotation: ${annotation.text} at position ${annotation.position}`);
      try {
        const annotationSvg = createAnnotationSVG(annotation);
        console.log(`[DEBUG] Created SVG for annotation:`, annotationSvg.substring(0, 100) + '...');
        
        const position = getAnnotationPosition(annotation.position, imageWidth, imageHeight);
        console.log(`[DEBUG] Annotation position: top=${position.top}, left=${position.left}`);
        
        image = image.composite([{
          input: Buffer.from(annotationSvg),
          top: position.top,
          left: position.left
        }]);
        console.log(`[DEBUG] Annotation composite successful`);
      } catch (annotationError) {
        console.error(`[ERROR] Annotation composite failed:`, annotationError);
      }
    }
    
    const result = await image.toBuffer();
    console.log(`[DEBUG] Successfully created annotated image with ${annotations.length} annotations, size: ${result.length}`);
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to add annotations to image:`, error);
    // Return original screenshot if annotation fails
    return screenshot;
  }
}

// Simulate the _createAnnotationSVG method
function createAnnotationSVG(annotation) {
  const { text, style } = annotation;
  const padding = 8;
  const lineHeight = style.fontSize + 4;
  const lines = text.split('\n');
  const textHeight = lines.length * lineHeight;
  
  // Limit width to reasonable size to avoid Sharp compositing errors
  const estimatedTextWidth = Math.max(...lines.map(line => line.length * style.fontSize * 0.6));
  const maxWidth = 400; // Maximum annotation width
  const width = Math.min(estimatedTextWidth + padding * 2, maxWidth);
  const height = textHeight + padding * 2;
  
  const textElements = lines.map((line, index) => 
    `<text x="${padding}" y="${padding + style.fontSize + (index * lineHeight)}" font-family="Arial, sans-serif" font-size="${style.fontSize}" fill="${style.textColor}">${line}</text>`
  ).join('');
  
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${style.backgroundColor}" rx="4"/>
    ${textElements}
  </svg>`;
}

// Simulate the _getAnnotationPosition method
function getAnnotationPosition(position, imageWidth, imageHeight) {
  // Calculate positions based on actual image dimensions, ensuring annotations stay within bounds
  const maxAnnotationWidth = 400;
  const annotationHeight = 80; // Estimated max annotation height
  
  switch (position) {
    case 'top-left': return { top: 50, left: 10 };
    case 'top-right': return { top: 50, left: Math.max(10, imageWidth - maxAnnotationWidth - 10) };
    case 'bottom-left': return { top: Math.max(60, imageHeight - annotationHeight - 10), left: 10 };
    case 'bottom-right': return { 
      top: Math.max(60, imageHeight - annotationHeight - 10), 
      left: Math.max(10, imageWidth - maxAnnotationWidth - 10) 
    };
    case 'center': return { 
      top: Math.max(60, imageHeight / 2 - annotationHeight / 2), 
      left: Math.max(10, imageWidth / 2 - maxAnnotationWidth / 2) 
    };
    default: return { 
      top: Math.max(60, imageHeight - annotationHeight - 10), 
      left: Math.max(10, imageWidth - maxAnnotationWidth - 10) 
    };
  }
}

testAnnotationFlow();

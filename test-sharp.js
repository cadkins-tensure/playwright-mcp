import sharp from 'sharp';
import fs from 'fs';

async function testSharp() {
  console.log('Testing Sharp library...');
  
  try {
    // Create a simple test image
    const testImage = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
    
    console.log('Created test image, size:', testImage.length);
    
    // Test SVG overlay
    const svg = `<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="50" fill="rgba(255,0,0,0.8)" rx="4"/>
      <text x="10" y="30" font-family="Arial, sans-serif" font-size="16" fill="white">Test Annotation</text>
    </svg>`;
    
    const annotatedImage = await sharp(testImage)
      .composite([{
        input: Buffer.from(svg),
        top: 10,
        left: 10
      }])
      .png()
      .toBuffer();
    
    console.log('Created annotated image, size:', annotatedImage.length);
    
    // Save both images for comparison
    await fs.promises.writeFile('test-original.png', testImage);
    await fs.promises.writeFile('test-annotated.png', annotatedImage);
    
    console.log('Test completed successfully! Check test-original.png and test-annotated.png');
    
  } catch (error) {
    console.error('Sharp test failed:', error);
  }
}

testSharp();

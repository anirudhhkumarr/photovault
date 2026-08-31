const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const result = await page.evaluate(async () => {
    const codecs = [
      'hvc1.1.6.L120.90', // Main 4:2:0 8-bit
      'hvc1.2.4.L120.B0', // Main 10 (4:2:0 10-bit)
      'hev1.2.4.L120.B0',
      'hvc1.4.10.L120.90', // Main 4:4:4 10?
      'hev1.4.10.L120.90'
    ];
    
    let supported = [];
    for (const codec of codecs) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30
        });
        if (support.supported) supported.push(codec);
      } catch (e) {
        // ignore
      }
    }
    return supported;
  });
  
  console.log('Supported codecs:', result);
  await browser.close();
})();

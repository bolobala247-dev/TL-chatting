const fs = require('fs');
const path = require('path');

const env = process.argv[2];

if (!['dev', 'prod'].includes(env)) {
  console.error('Vui lòng truyền đối số hợp lệ: "dev" hoặc "prod"');
  process.exit(1);
}

const sourceFile = env === 'dev' ? '.env.development' : '.env.production';
const targetFile = '.env.local';

const sourcePath = path.resolve(process.cwd(), sourceFile);
const targetPath = path.resolve(process.cwd(), targetFile);

if (!fs.existsSync(sourcePath)) {
  console.error(`Không tìm thấy file nguồn: ${sourceFile}`);
  console.log(`Hãy tạo file ${sourceFile} với cấu hình tương ứng trước.`);
  process.exit(1);
}

try {
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`🎉 Successfully switched to ${env.toUpperCase()} environment!`);
  console.log(`Copied ${sourceFile} to ${targetFile}`);
} catch (error) {
  console.error('Lỗi khi sao chép file cấu hình:', error);
  process.exit(1);
}

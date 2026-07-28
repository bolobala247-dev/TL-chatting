// Config plugin: tối ưu hiệu năng Gradle cho bản build Android sinh ra bởi prebuild (CNG).
// Vì thư mục android/ nằm trong .gitignore, EAS Build chạy `expo prebuild` mỗi lần build —
// plugin này đảm bảo gradle.properties luôn chứa các cờ tối ưu build, KHÔNG thay đổi runtime.
const { withGradleProperties } = require("expo/config-plugins");

const GRADLE_PROPERTIES = [
  // Tăng heap cho Gradle daemon (worker EAS có 16 GB RAM; mặc định 2 GB gây GC thrashing)
  { key: "org.gradle.jvmargs", value: "-Xmx4096m -XX:MaxMetaspaceSize=1024m" },
  // Build các module song song (đã là mặc định của template, giữ tường minh)
  { key: "org.gradle.parallel", value: "true" },
  // Bật Gradle build cache — cho phép tái sử dụng task output (kết hợp EAS_USE_CACHE)
  { key: "org.gradle.caching", value: "true" },
  // Tắt AAPT2 PNG crunch ở bản release — ảnh trong assets/ đã được tối ưu sẵn,
  // crunch lại chỉ tốn CPU mà không thay đổi hành vi runtime
  { key: "android.enablePngCrunchInReleaseBuilds", value: "false" },
];

module.exports = function withGradleBuildOptimizations(config) {
  return withGradleProperties(config, (config) => {
    for (const { key, value } of GRADLE_PROPERTIES) {
      const existing = config.modResults.find(
        (item) => item.type === "property" && item.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        config.modResults.push({ type: "property", key, value });
      }
    }
    return config;
  });
};

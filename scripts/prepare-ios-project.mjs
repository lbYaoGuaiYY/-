import { readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const projectYmlPath = resolve(projectRoot, "src-tauri/gen/apple/project.yml")
const projectFilePath = resolve(
  projectRoot,
  "src-tauri/gen/apple/qingshe-desktop.xcodeproj/project.pbxproj",
)
const infoPlistPath = resolve(projectRoot, "src-tauri/gen/apple/qingshe-desktop_iOS/Info.plist")
const buildArtifactsPath = resolve(projectRoot, "src-tauri/gen/apple/build")

// Tauri renames the archived bundle to the configured product name. A bundle
// left by an earlier build makes that rename fail with ENOTEMPTY, so generated
// Xcode outputs must never survive the source/config synchronization step.
await rm(buildArtifactsPath, { recursive: true, force: true })

const projectYml = await readFile(projectYmlPath, "utf8")
const xcodeBuildScript = "$SRCROOT/../../../scripts/xcode-ios-rust-build.sh"
const xcodeBuildArguments = `-v --platform \${PLATFORM_DISPLAY_NAME:?} --sdk-root \${SDKROOT:?} --framework-search-paths "\${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "\${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "\${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration \${CONFIGURATION:?} \${FORCE_COLOR} \${ARCHS:?}`
const xcodeQuoteEscape = String.fromCharCode(92, 34)
const nextProjectYml = projectYml
  .replace("    iOS: 14.0", "    iOS: 15.0")
  .replace(
    /- script: pnpm tauri ios xcode-script[^\n]*/,
    `- script: "${xcodeBuildScript}" ${xcodeBuildArguments}`,
  )
if (nextProjectYml !== projectYml) await writeFile(projectYmlPath, nextProjectYml)

const projectFile = await readFile(projectFilePath, "utf8")
const nextProjectFile = projectFile
  .replace(/IPHONEOS_DEPLOYMENT_TARGET = 14\.0;/g, "IPHONEOS_DEPLOYMENT_TARGET = 15.0;")
  .replace(
    /(\/\* assets \*\/ = \{isa = PBXFileReference;)[^\n]*sourceTree = SOURCE_ROOT; \};/,
    "$1 lastKnownFileType = folder; path = assets; sourceTree = SOURCE_ROOT; };",
  )
  .replace(
    /shellScript = "pnpm tauri ios xcode-script[^;]*";/,
    `shellScript = "\\"${xcodeBuildScript}\\" ${xcodeBuildArguments.replaceAll('"', xcodeQuoteEscape)}";`,
  )
if (nextProjectFile !== projectFile) await writeFile(projectFilePath, nextProjectFile)

if (
  !nextProjectYml.includes("    iOS: 15.0") ||
  !nextProjectFile.includes("IPHONEOS_DEPLOYMENT_TARGET = 15.0;") ||
  !nextProjectYml.includes("scripts/xcode-ios-rust-build.sh") ||
  !nextProjectFile.includes("scripts/xcode-ios-rust-build.sh") ||
  !nextProjectFile.includes("lastKnownFileType = folder; path = assets; sourceTree = SOURCE_ROOT;")
) {
  throw new Error("iPadOS 工程不存在预期的 deployment target 配置")
}

const infoPlist = await readFile(infoPlistPath, "utf8")
const sceneManifest = `	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<true/>
		<key>UISceneConfigurations</key>
		<dict>
			<key>UIWindowSceneSessionRoleApplication</key>
			<array>
				<dict>
					<key>UISceneConfigurationName</key>
					<string>TaoScene</string>
					<key>UISceneDelegateClassName</key>
					<string>TaoSceneDelegate</string>
				</dict>
			</array>
		</dict>
	</dict>`
const nextInfoPlist = infoPlist.includes("<key>UIApplicationSceneManifest</key>")
  ? infoPlist
      .replace(/(<key>UIApplicationSupportsMultipleScenes<\/key>\s*)<false\/>/, "$1<true/>")
      .replace(
        /(<key>UISceneConfigurationName<\/key>\s*)<string>Default Configuration<\/string>/,
        "$1<string>TaoScene</string>",
      )
  : infoPlist.replace(
      "\t<key>UILaunchStoryboardName</key>",
      `${sceneManifest}\n\t<key>UILaunchStoryboardName</key>`,
    )

if (nextInfoPlist !== infoPlist) await writeFile(infoPlistPath, nextInfoPlist)

let finalInfoPlist = await readFile(infoPlistPath, "utf8")
if (!finalInfoPlist.includes("<key>UIStatusBarStyle</key>")) {
  finalInfoPlist = finalInfoPlist.replace(
    "</dict>\n</plist>",
    `\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<false/>\n\t<key>UIStatusBarStyle</key>\n\t<string>UIStatusBarStyleLightContent</string>\n\t<key>UIRequiresFullScreen</key>\n\t<false/>\n</dict>\n</plist>`,
  )
  await writeFile(infoPlistPath, finalInfoPlist)
}
if (
  !finalInfoPlist.includes("<string>TaoScene</string>") ||
  !finalInfoPlist.includes("<string>TaoSceneDelegate</string>")
) {
  throw new Error("iPadOS Info.plist 不存在 TaoScene scene 配置")
}

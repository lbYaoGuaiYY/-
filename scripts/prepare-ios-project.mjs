import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const projectRoot = resolve(new URL("..", import.meta.url).pathname)
const projectYmlPath = resolve(projectRoot, "src-tauri/gen/apple/project.yml")
const projectFilePath = resolve(
  projectRoot,
  "src-tauri/gen/apple/qingshe-desktop.xcodeproj/project.pbxproj",
)
const infoPlistPath = resolve(projectRoot, "src-tauri/gen/apple/qingshe-desktop_iOS/Info.plist")

const projectYml = await readFile(projectYmlPath, "utf8")
const nextProjectYml = projectYml.replace("    iOS: 14.0", "    iOS: 15.0")
if (nextProjectYml !== projectYml) await writeFile(projectYmlPath, nextProjectYml)

const projectFile = await readFile(projectFilePath, "utf8")
const nextProjectFile = projectFile.replace(
  /IPHONEOS_DEPLOYMENT_TARGET = 14\.0;/g,
  "IPHONEOS_DEPLOYMENT_TARGET = 15.0;",
)
if (nextProjectFile !== projectFile) await writeFile(projectFilePath, nextProjectFile)

if (
  !nextProjectYml.includes("    iOS: 15.0") ||
  !nextProjectFile.includes("IPHONEOS_DEPLOYMENT_TARGET = 15.0;")
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
if (
  !nextInfoPlist.includes("<string>TaoScene</string>") ||
  !nextInfoPlist.includes("<string>TaoSceneDelegate</string>")
) {
  throw new Error("iPadOS Info.plist 不存在 TaoScene scene 配置")
}

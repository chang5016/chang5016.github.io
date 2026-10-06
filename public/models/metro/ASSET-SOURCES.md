# 海灣機車捷運：下載模型來源

捷運的列車外殼、底盤、地板、車門、電梯、站體、雨棚、護欄、橋墩、軌道、座椅、照明及電子看板外殼均由下列下載模型建立。程式只安排位置、適應機車尺寸、裁切通道、整合材質、動畫、隱形碰撞與螢幕資訊；沒有以 Box、Cylinder、Plane 等自製可見幾何替代模型。

## 現役完整列車：JFR1

- 下載自下列 Libre-TrainSim 的 `Trains/JFR1/Wagon_1_WithDriverStand.obj`，作者 Jean3219，資源授權 CC0。
- 使用完整車體、原始地板、曲面車頂、窗戶、輪組及駕駛艙；以 **2.15 倍等比例**放大，車長 35.72 m、車體寬 6.60 m。保留來源原始紅白塗裝與完整解析度 PBR 紋理，沒有改成自製外殼。
- 移除機車通道內的完整座椅／扶手組件及其原始底座面，保留連續原始地板。六組原始出入口搭配下載的 JFR1 車門及實體電子看板。
- 原始 Godot AMR 貼圖只重新排列通道為 glTF ORM，沒有降低解析度。

## 保留的上海磁浮來源（目前未載入）

- 原始下載頁：[Shanghai Maglev Train — CadNav](https://www.cadnav.com/3d-models/model-36867.html)。此為使用者提供的 FetchCFD 展示頁所標示的上游來源；使用的是 CadNav 公開下載的原始 3DS，不是從 FetchCFD 檢視器擷取的檔案。
- 原始檔：`C0818132.3DS`；原始 SHA-256：`82de92c3c55119386b94f8473848acab99e7f9f495743d6ef4fc084b4bdf156d`。
- 網頁標示 non-commercial，本免費遊戲採非商業用途。原包附註允許修改及作為作品／專案的一部分使用，禁止單獨轉售或再分發原包。保留 [CadNav 原包附註](downloaded/CadNav-NOTICE.txt)。
- 保留完整 34.42 m 外殼和車頭造型，以兩端相反朝向排列。車廂寬度調整為 6.2 m、乘車淨高 3.5 m；開設機車出入口，清理原始內部構造面，底盤從原始展開位置移回車體底下。沒有替換為自製列車。

## 車站及列車部件

來自 [Libre-TrainSim](https://github.com/Libre-TrainSim/Libre-TrainSim)，來源版本 `1e22e0eefe3d7e7dea8f21b695cc55e659ef4ccb`。

本次只使用資源模型與材質；**程式碼倉庫的 GPL 授權與資源包的 CC0 授權不同**。資源作者 Jean28518、JFR1 列車資源作者 Jean3219 的原始 CC0 聲明均已隨檔保留：[資源授權](downloaded/Libre-Resources-LICENSE.txt)、[JFR1 授權](downloaded/Libre-JFR1-LICENSE.txt)。

| 遊戲部件 | 原始下載模型 | 改作 |
|---|---|---|
| 電梯井／移動轎廂 | `Lift-Subway.obj` | 依實際機車連同騎士約 2.99 m 高度設計；轎廂 7.2 m、淨高 5.85 m、雙門淨寬 5.4 m。清除完整運行空間內的原始橫板，保留外側玻璃與鋼構 |
| 挑高玻璃站房 | `TrainStationBuilding4.obj`、`Platform_double_roofing.obj` | 使用完整原始窗框、玻璃與分叉柱屋架，組成 44.8 × 108.8 m、淨高 31.4 m 的大廳，包覆兩座電梯；在街道、鐵道與月台留完整通口。窗框改為鋁合金 PBR 表面，原有小站房模型仍留存 |
| 車門／月台門／電梯門 | `Trains/JFR1/Door.obj` | 保留門框及玻璃，配合淨寬調整，移動或旋轉開啟 |
| 大廳／月台／入口鋪面 | `Platform-1_no_railings.obj` | 保留完整原始倒角、鋪面、安全條及側面，入口貼合整坡地表 |
| 護欄 | `Platform-1.obj` | 保留原始金屬護欄，安排真實出入口 |
| 雨棚／立柱／支架／照明 | `Platform_double_roofing.obj` | 完整站體模組；原始 LED 模組另用於車廂 |
| 高架橋面 | `Subway_Bridge_WithEdges.obj` | 保留原始護牆與橋面，依軌道寬度配置 |
| 橋墩 | `BridgePfost1.obj` | 原始 T 型混凝土橋墩，依地形高度及跨距調整 |
| 鐵軌／枕木／道床 | `RailTypes/Rail_Beton_1.obj` | 修正原始鋼軌長軸與輪底高度，以 1 m 鋼軌單元連續鋪設；每 96 m 共享實例與視錐裁切 |
| 軌道終點止衝擋 | `bumper.obj` | 完整原始鋼構、橡膠墊及紅白停止目標等比例 1.8 倍；兩端各保留 84 m 高架延伸，止擋離終站列車鼻端超過 40 m，末端配置護欄及實體警示看板 |
| 座椅 | `Bench.obj` | 保留完整木板、支腳與原始材質 |
| 電梯地板／登車銜接板／門上橫楣 | `Ceiling.obj` | 保留原始面板幾何，按用途及尺寸配置。電梯地板使用原包鋪面 PBR；來源面板原本沒有 UV，另以實際鋪面尺寸投影 |
| 實體電子看板 | `DestinationSignFromUp.obj` | 車站保留原始吊掛裝置；車內外殼厚度調為 4.8 cm，直接貼合下載面板組成的門上橫楣，寬度符合原車門淨寬。資訊以約 20 cm 高的主要站名字為主 |

## 檔案追溯與效能

[完整來源、改作、原始與輸出 SHA-256 清單](downloaded/sources.json)。每個可見模型帶來源資料，載入與建置時會檢查。重複車門、鋼軌及電梯共用 GPU 實例；靜態站體按材質及區塊整合，不簡化三角形，保留來源既有 UV 和法線。材質採原資源圖片及金屬度／粗糙度設定；WebP 僅做無損轉檔，逐像素 RGBA 比對後才使用，沒有降解析度。

電子看板中文字型是 Noto Sans TC 的字元子集，改名 Metro Display，保留 SIL Open Font License 1.1：[字型來源與改作](../../fonts/metro-display-source.json)、[字型授權](../../fonts/metro-display-OFL.txt)。

車內門上 LCD 參考 [MTR 官方新車介紹](https://www.mtr.com.hk/en/corporate/projects/projects_ops_improve_train.html) 及其實車照片的橫向路線圖、目前／下一站、白底資訊區。保留下載模型的立體外框及雙面螢幕，像素資料每秒按真實列車狀態更新並共用紋理；螢幕放在原始曲面車頂之下，最低邊高於 3.5 m。

車廂內側頂棚仍是原始 JFR1 三角形，只重新分配原資源白色塑膠材質；來源座標、法線與 UV 未變。原車體貼圖的陰影已烘焙，因此減輕重複環境遮蔽；原燈具搭配三盞重用的近距離實際光源，放在內頂棚下方，無逐幀新增光源、陰影圖或幾何。大廳窗框採共享實例，新增模型也重用逐像素相同的既有無損 WebP 貼圖，避免重複下載及解碼約 19.8 MB 的 PNG。

可重現的轉換流程保存在 `scripts/metro-import/`。站體的道路淨空、六部電梯上下往返、實體通道、無閘門進站、登車、門口連鎖與月台接縫另有實際 GLB 幾何測試。

原有都市建築貼皮、玩家水豚機車模型與城市懸索大橋保留。雙向入口延續原地面道路的寬度及車道，而非在其上疊一條單向匝道。

## 2026-10-03：完整城市淨空及一樓地坪修正

MB01 移到鄰近南北向道路旁的空地，避開原高速公路聯絡匝道。使用整個大廳的平面外框逐一檢查所有高架道路及交會面的實際輪廓，三座站體均無道路重疊。原下載電梯井僅調整運行跨度，保留門口尺寸、材料及原始 UV；出口高度仍為 21.6 m。

大廳的下載鋪面分配於電梯井四周，井內只保留移動轎廂的地板，消除一樓兩層地板共面造成的閃爍。粗地形與站區細地形都在鋪面下留出空間，草叢也避開完整站房和入口。入口遮棚、支柱及休息座椅繼續使用同一下載資源庫的完整部件。

月台限速及所有營運看板統一為 **25 km/h**；大廳保留正常騎乘控制。列車運行時間同時滿足速度和加速度上限，站址調整不增加乘車頓挫。車內門上螢幕共用更新的像素緩衝，大字目前／下一站與倒數配合實際班次。

驗證涵蓋完整既有都市、高速公路、三站、六部電梯及下載列車，包含實際模型通道、往返、載車、門口連鎖與一樓地板唯一性。另以原生 WebGPU 實際解碼貼圖，驗證入口、山坡站地坪、轎廂、車內螢幕及原玩家機車排氣。此為內部畫面驗證，沒有宣稱雲端瀏覽器或實機 FPS 驗收。


## 2026-10-04 — source-derived connections and recessed doors
All new visible parts derive from the downloaded JFR1 geometry. Platform door pockets use the original framed leaf, refitted to 1.72 m enclosure width. Train leaves first retract 11 cm inward, then slide along the body; the 32 cm platform gap is covered by a continuous downloaded floor panel. Rounded flexible inter-car folds and aluminium collars preserve a 3.44 m by 3.72 m passage. The rear vestibule clearance includes the original interior brace while retaining the native floor. Reproducible conversion: scripts/metro-import/refine-connections-v90.mjs. Source manifests retain upstream author, license and hashes.

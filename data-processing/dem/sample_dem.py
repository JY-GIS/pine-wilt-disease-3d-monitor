import rasterio


dem_path = r"D:\pine-wilt-disease-3d-monitor\downloads\DEM\shandong-dem-12.5.tif"


with rasterio.open(dem_path) as dataset:
    print('--------------------------------------')
    print("坐标系:")
    print(dataset.crs)
    print('--------------------------------------')
    print("范围:")
    print(dataset.bounds)
    print('--------------------------------------')
    print("波段:")
    print(dataset.count)
    print('--------------------------------------')
    print("NoData:")
    print(dataset.nodata)
    print('--------------------------------------')


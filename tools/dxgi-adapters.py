import ctypes
import json
from ctypes import wintypes


class GUID(ctypes.Structure):
    _fields_ = [('Data1', ctypes.c_ulong), ('Data2', ctypes.c_ushort), ('Data3', ctypes.c_ushort), ('Data4', ctypes.c_ubyte * 8)]


class DXGI_ADAPTER_DESC1(ctypes.Structure):
    _fields_ = [('Description', ctypes.c_wchar * 128), ('VendorId', ctypes.c_uint), ('DeviceId', ctypes.c_uint), ('SubSysId', ctypes.c_uint), ('Revision', ctypes.c_uint), ('DedicatedVideoMemory', ctypes.c_size_t), ('DedicatedSystemMemory', ctypes.c_size_t), ('SharedSystemMemory', ctypes.c_size_t), ('LuidLow', ctypes.c_uint), ('LuidHigh', ctypes.c_int), ('Flags', ctypes.c_uint)]


def method(pointer, index, restype, *arguments):
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *arguments)(table[index])


def adapters():
    identifier = GUID(0x770aae78, 0xf26f, 0x4dba, (ctypes.c_ubyte * 8)(0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87))
    factory = ctypes.c_void_p()
    result = ctypes.WinDLL('dxgi').CreateDXGIFactory1(ctypes.byref(identifier), ctypes.byref(factory))
    if result != 0:
        raise RuntimeError('CreateDXGIFactory1 failed: ' + str(result))
    entries = []
    try:
        for index in range(32):
            adapter = ctypes.c_void_p()
            result = method(factory, 12, ctypes.c_long, ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p))(factory, index, ctypes.byref(adapter))
            if result != 0:
                break
            try:
                description = DXGI_ADAPTER_DESC1()
                result = method(adapter, 10, ctypes.c_long, ctypes.POINTER(DXGI_ADAPTER_DESC1))(adapter, ctypes.byref(description))
                if result != 0:
                    raise RuntimeError('GetDesc1 failed: ' + str(result))
                entries.append({'deviceId': index, 'name': description.Description, 'vendorId': description.VendorId, 'software': bool(description.Flags & 2), 'dedicatedBytes': description.DedicatedVideoMemory, 'luid': format(description.LuidHigh & 0xffffffff, '08x') + ':' + format(description.LuidLow, '08x')})
            finally:
                method(adapter, 2, ctypes.c_ulong)(adapter)
    finally:
        method(factory, 2, ctypes.c_ulong)(factory)
    return entries


if __name__ == '__main__':
    print(json.dumps(adapters(), ensure_ascii=True))

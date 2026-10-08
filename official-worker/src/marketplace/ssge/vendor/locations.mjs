export function flattenLocations(locations) {
  const rows=[];
  for(const city of locations.visibleCities??[]) {
    rows.push({kind:'city',id:city.cityId,title:city.cityTitle,parentId:null});
    for(const district of city.districts??[]) {
      rows.push({kind:'district',id:district.districtId,title:district.districtTitle,parentId:city.cityId,cityId:city.cityId});
      for(const sub of district.subDistricts??[]) {
        rows.push({kind:'subdistrict',id:sub.subDistrictId,title:sub.subDistrictTitle,parentId:district.districtId,cityId:city.cityId});
        for(const street of sub.streets??[]) rows.push({kind:'street',id:street.streetId,title:street.streetTitle,parentId:sub.subDistrictId,cityId:city.cityId,latitude:street.latitude??null,longitude:street.longitude??null});
      }
    }
  }
  return rows;
}
export function resolveLocation(rows,kind,value,parentId) {
  const matches=rows.filter(r=>r.kind===kind&&(r.id===value||r.title===value)&&(parentId===undefined||r.parentId===parentId));
  if(matches.length!==1) throw new Error(`Unknown or ambiguous ${kind}: ${value}`);
  return matches[0];
}

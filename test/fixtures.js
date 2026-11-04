// 게임위 Open API 가이드의 '출력 샘플'을 기반으로 한 XML
// (가이드 샘플의 오타 — `<?xml ... "UTF-8">`, 닫히지 않은 <gametitle> — 만 바로잡음)
export const GUIDE_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <tcount>3</tcount><pageno>1</pageno><res_date>2015-01-05 오전 9:00:00</res_date>
  <item><rateno/><rateddate>2015-01-05</rateddate><gametitle>게임물명1</gametitle><orgname>게임물관리위원회</orgname>
    <entname>테스트게임사</entname><summary/><givenrate>등급거부</givenrate><genre/><platform/><descriptors/>
    <cancelstatus>False</cancelstatus><canceleddate/></item>
  <item><rateno>CC-NM-230601-xxx</rateno><rateddate>2023-06-01</rateddate><gametitle>게임물명2</gametitle>
    <orgname>게임물관리위원회</orgname><entname>테스트게임사</entname><summary>게임물개요입니다.</summary>
    <givenrate>청소년이용불가</givenrate><genre>액션</genre><platform>PC/온라인 게임</platform>
    <descriptors>폭력성,언어</descriptors><cancelstatus>False</cancelstatus><canceleddate/></item>
  <item><rateno>CC-OM-230602-xxx</rateno><rateddate>2023-06-02</rateddate><gametitle>게임물명3</gametitle>
    <orgname>게임물관리위원회</orgname><entname>테스트게임사</entname><summary>게임물개요입니다.</summary>
    <givenrate>청소년이용불가</givenrate><genre>퍼즐</genre><platform>아케이드 게임</platform>
    <descriptors>폭력성,언어</descriptors><cancelstatus>True</cancelstatus><canceleddate>2023-06-25</canceleddate></item>
</result>`;


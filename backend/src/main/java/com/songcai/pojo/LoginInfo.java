package com.songcai.pojo;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

//封装登录结果
@Data
@AllArgsConstructor
@NoArgsConstructor
public class LoginInfo {
    private String id;
    private String username;
    private String password;
    private String token;
}

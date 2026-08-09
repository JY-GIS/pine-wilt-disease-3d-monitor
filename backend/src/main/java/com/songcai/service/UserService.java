package com.songcai.service;

import com.songcai.pojo.LoginInfo;
import com.songcai.pojo.User;

import java.util.List;

public interface UserService {

    List<User> findAll();

    void deleteById(String userId);

    void addInfor(User user);


    List<User> getInfo(String userId);

    void updateName(String userId, String username);

    void updatePhone(String userId, String phone);

    LoginInfo login(String username,String password);
}

